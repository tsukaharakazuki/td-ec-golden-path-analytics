"""DuckDB smoke test for the golden_path workflow.

Walks the .dig files in task order, renders every `td>` query with params.yml (+ test overrides),
transpiles it from Trino to DuckDB with sqlglot, and runs it as CREATE TABLE.

This is an approximation of Treasure Data (TD-specific functions are shimmed as DuckDB macros),
so it checks structure, column references and logic on synthetic data. It does not replace a
dry run on the real TD account.

usage: python3 tests/sql_smoke/run.py <duckdb file> [--export <dir>]
"""
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta

import duckdb
import sqlglot
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WF = os.path.join(ROOT, "skills", "td-ec-golden-path-analytics", "workflow", "golden_path")
EXPORT_DIR = os.path.join(ROOT, "skills", "td-ec-golden-path-analytics", "export")
JST = timezone(timedelta(hours=9))
SCHEDULED = int(datetime(2026, 10, 12, 4, 0, tzinfo=JST).timestamp())


def deep_merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            deep_merge(a[k], v)
        else:
            a[k] = v
    return a


def load_params():
    with open(os.path.join(WF, "config", "params.yml"), encoding="utf-8") as f:
        params = yaml.safe_load(f)
    with open(os.path.join(os.path.dirname(__file__), "params.test.yml"), encoding="utf-8") as f:
        deep_merge(params, yaml.safe_load(f))
    return params


def lookup(params, expr):
    neg = expr.startswith("!")
    path = expr[1:] if neg else expr
    cur = params
    for part in re.findall(r"[^.\[\]]+", path):
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            if part not in cur:
                raise KeyError(f"unknown parameter ${{{expr}}}")
            cur = cur[part]
    if neg:
        return not cur
    return cur


def render(text, params):
    def rep(m):
        v = lookup(params, m.group(1).strip())
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, (dict, list)):
            raise ValueError(f"parameter ${{{m.group(1)}}} is not a scalar")
        return str(v)
    return re.sub(r"\$\{([^}]+)\}", rep, text)


def load_dig(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r"^!include\s*:.*$", "", text, flags=re.M)
    return yaml.safe_load(text)


def walk(node, base_dir, params, out):
    """Collect (sql_path, table) in execution order, honoring if> and call>."""
    for key, val in node.items():
        if not key.startswith("+") or not isinstance(val, dict):
            continue
        if "if>" in val:
            cond = render(str(val["if>"]), params)
            if cond not in ("true", "false"):
                raise ValueError(f"if> did not evaluate to a boolean: {val['if>']} -> {cond}")
            if cond == "true":
                walk({"+do": val["_do"]}, base_dir, params, out)
            continue
        if "call>" in val:
            child = os.path.normpath(os.path.join(base_dir, val["call>"]))
            if not os.path.exists(child):
                raise FileNotFoundError(child)
            walk(load_dig(child), os.path.dirname(child), params, out)
            continue
        if "td>" in val:
            sql = os.path.normpath(os.path.join(base_dir, val["td>"]))
            if not os.path.exists(sql):
                raise FileNotFoundError(sql)
            table = val.get("create_table") or val.get("insert_into")
            out.append((sql, table))
            continue
        if "td_ddl>" in val:
            continue
        walk(val, base_dir, params, out)


SHIMS = f"""
CREATE OR REPLACE MACRO td_scheduled_time() AS {SCHEDULED};
CREATE OR REPLACE MACRO td_date_trunc(unit, t, tz) AS CAST(floor((t + 32400) / 86400) * 86400 - 32400 AS BIGINT);
CREATE OR REPLACE MACRO td_interval(t, spec, tz) AS
  t >= td_date_trunc('day', td_scheduled_time(), tz) - CAST(regexp_extract(spec, '-?(\\d+)d', 1) AS BIGINT) * 86400
  AND t < td_date_trunc('day', td_scheduled_time(), tz);
CREATE OR REPLACE MACRO url_extract_host(u) AS NULLIF(lower(regexp_extract(u, '^[a-zA-Z]+://([^/:?#]+)', 1)), '');
CREATE OR REPLACE MACRO url_extract_path(u) AS regexp_extract(u, '^[a-zA-Z]+://[^/?#]*([^?#]*)', 1);
CREATE OR REPLACE MACRO url_extract_parameter(u, name) AS NULLIF(regexp_extract(u, '[?&]' || name || '=([^&#]*)', 1), '');
"""


def to_duckdb(sql):
    sql = sql.replace("TD_SCHEDULED_TIME()", "td_scheduled_time()")
    out = sqlglot.transpile(sql, read="trino", write="duckdb", pretty=True)
    if len(out) != 1:
        raise ValueError("expected exactly one statement")
    s = out[0]
    # sqlglot keeps Trino's printf-style FORMAT; DuckDB's equivalent is PRINTF
    s = re.sub(r"\bFORMAT\(", "PRINTF(", s)
    # DuckDB's approx_quantile takes FLOAT quantiles
    s = re.sub(r"(APPROX_QUANTILE\([^\[]*?)\[([^\]]*)\]", r"\1[\2]::FLOAT[]", s)
    s = re.sub(r"(APPROX_QUANTILE\([^,()]*(?:\([^()]*\))?[^,()]*,\s*)([0-9.]+(?:E0|e0)?)\)", r"\1CAST(\2 AS FLOAT))", s)
    # Trino's reverse(array) is list_reverse in DuckDB
    s = re.sub(r"\bREVERSE\(\s*(LIST_SORT|ARRAY_SORT)", r"LIST_REVERSE(\1", s)
    return s


def main():
    db = sys.argv[1]
    export_dir = sys.argv[sys.argv.index("--export") + 1] if "--export" in sys.argv else None
    playbook = "--playbook" in sys.argv
    discovery_dir = sys.argv[sys.argv.index("--discovery") + 1] if "--discovery" in sys.argv else None
    params = load_params()
    con = duckdb.connect(db)
    for stmt in SHIMS.strip().split(";\n"):
        if stmt.strip():
            con.execute(stmt)
    # the queries refer to output tables without a schema, like td> with database: <common.database>
    steps = []
    walk(load_dig(os.path.join(WF, "golden_path.dig")), WF, params, steps)
    failures = 0
    for sql_path, table in steps:
        rel = os.path.relpath(sql_path, WF)
        rendered = render(open(sql_path, encoding="utf-8").read(), params)
        if "${" in rendered:
            raise ValueError(f"unrendered parameter in {rel}")
        try:
            duck = to_duckdb(rendered)
            con.execute(f"CREATE OR REPLACE TABLE {table} AS {duck}")
            n = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"ok   {table:<32} {n:>8} rows  ({rel})")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"FAIL {table:<32} ({rel})\n     {type(e).__name__}: {str(e)[:600]}")
            debug = os.path.join(os.path.dirname(db), f"failed_{table}.sql")
            with open(debug, "w", encoding="utf-8") as f:
                f.write(duck if "duck" in dir() else rendered)
            break
    if failures:
        sys.exit(1)
    if discovery_dir:
        # rendered by: gp-cli.mjs discovery-sql --params <merged params> --out <dir>; source tables live in schema src
        for name in sorted(os.listdir(discovery_dir)):
            sql = open(os.path.join(discovery_dir, name), encoding="utf-8").read()
            try:
                df = con.execute(to_duckdb(sql)).fetchdf()
                print(f"discovery {name:<30} {len(df):>4} rows")
                print(df.head(6).to_string(max_colwidth=40))
            except Exception as e:  # noqa: BLE001
                print(f"discovery FAIL {name}: {type(e).__name__}: {str(e)[:300]}")
    if playbook:
        md = open(os.path.join(ROOT, "skills", "td-ec-golden-path-analytics", "references", "analysis-playbook.md"), encoding="utf-8").read()
        fill = {
            "{{db}}.": "",
            "<名前の一部>": "pmax",
            "<商品グループ>": "アウター",
            "<touch_key>": "google / cpc / pmax_all_products",
            "<email_key>": "newsletter / email / season_sale",
        }
        for block in re.findall(r"```sql\n(.*?)```", md, flags=re.S):
            name = re.search(r"PLAYBOOK (\w+)", block).group(1)
            sql = block
            for k, v in fill.items():
                sql = sql.replace(k, v)
            try:
                n = len(con.execute(to_duckdb(sql)).fetchall())
                print(f"playbook {name:<28} {n:>4} rows")
            except Exception as e:  # noqa: BLE001
                print(f"playbook FAIL {name}: {type(e).__name__}: {str(e)[:300]}")
    if export_dir:
        os.makedirs(export_dir, exist_ok=True)
        for name in sorted(os.listdir(EXPORT_DIR)):
            if not name.endswith(".sql"):
                continue
            sql = open(os.path.join(EXPORT_DIR, name), encoding="utf-8").read()
            sql = sql.replace("{{database}}.", "")
            duck = to_duckdb(sql)
            rows = con.execute(duck).fetchdf()
            rows = json.loads(rows.to_json(orient="records", force_ascii=False))
            with open(os.path.join(export_dir, name.replace(".sql", ".json")), "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False)
            print(f"export {name:<34} {len(rows):>6} rows")
    con.close()


if __name__ == "__main__":
    main()
