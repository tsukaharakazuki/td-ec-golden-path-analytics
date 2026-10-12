"""Synthetic EC data for the DuckDB smoke test and the dashboard sample.

Creates four source tables in a DuckDB database:
  src.weblog_pageviews   td-js-sdk style page views (td_url, td_referrer, td_client_id, member_id, ecommerce JSON)
  src.crm_members        member master
  src.pos_order_lines    POS lines (store + EC)
  src.product_master     product master

The generator plants a few "golden paths" so the scoring has something to find:
  - Email > Direct visitors who search and view several product pages, buy outerwear, and come back (loyal)
  - PMax first touches that buy tops once (new customers, low repeat)
  - LINE > Organic Search visitors who read features before buying shoes
It also reproduces the TD log quirks the workflow has to handle:
  - back/forward re-recording of the landing URL with its utm parameters
  - payment-service referrers (paypay / rakuten pay) on the thanks page
"""
import json
import random
import sys
from datetime import datetime, timezone, timedelta

import duckdb

SEED = 7
JST = timezone(timedelta(hours=9))
END = int(datetime(2026, 10, 12, tzinfo=JST).timestamp())  # scheduled day start (JST)
DAYS = 90
HOST = "www.example-fashion.jp"

CATEGORIES = {
    "アウター": (18000, 42000),
    "トップス": (3900, 9800),
    "ボトムス": (5900, 14800),
    "シューズ": (8900, 24000),
    "バッグ": (6900, 29000),
    "アクセサリー": (1900, 7900),
}
BRANDS = ["MIX LABEL", "NORTH ROW", "atelier ten", "CITY FIELD"]
PREFS = ["東京都", "神奈川県", "大阪府", "愛知県", "福岡県", "埼玉県", "千葉県", "北海道", "兵庫県", "京都府"]

TOUCHES = {
    "email_nl": ("utm", "newsletter", "email", "nl_weekly"),
    "email_new": ("utm", "newsletter", "email", "new_arrival_outer"),
    "email_sale": ("utm", "newsletter", "email", "season_sale"),
    "pmax": ("utm", "google", "cpc", "pmax_all_products"),
    "gsearch": ("gclid", None, None, None),
    "line": ("utm", "line", "social", "line_oa_weekly"),
    "ig_ad": ("utm", "instagram", "paid_social", "ig_lookbook"),
    "display": ("utm", "criteo", "display", "retargeting_cart"),
    "organic": ("ref", "https://www.google.com/", None, None),
    "yahoo": ("ref", "https://search.yahoo.co.jp/search?p=x", None, None),
    "insta": ("ref", "https://l.instagram.com/", None, None),
    "blog": ("ref", "https://fashion-blog.example.net/post/1", None, None),
    "direct": ("direct", None, None, None),
}


def make_products(rng):
    products = []
    pid = 1000
    for cat, (lo, hi) in CATEGORIES.items():
        for i in range(10):
            pid += 1
            price = int(rng.randint(lo, hi) / 100) * 100
            products.append({
                "product_id": f"P{pid}",
                "product_name": f"{cat} {chr(65 + i)}-{pid % 97}",
                "category": cat,
                "brand": rng.choice(BRANDS),
                "price": price,
            })
    return products


def landing_url(kind, path, rng):
    t = TOUCHES[kind]
    url = f"https://{HOST}{path}"
    sep = "&" if "?" in url else "?"
    if t[0] == "utm":
        url += f"{sep}utm_source={t[1]}&utm_medium={t[2]}&utm_campaign={t[3]}"
    elif t[0] == "gclid":
        url += f"{sep}gclid=Cj0K{rng.randint(10000, 99999)}"
    return url


def referrer_for(kind):
    t = TOUCHES[kind]
    if t[0] == "ref":
        return t[1]
    if t[0] == "utm" and t[1] == "instagram":
        return "https://l.instagram.com/"
    if t[0] == "gclid":
        return "https://www.google.com/"
    return None


def main(db_path):
    rng = random.Random(SEED)
    products = make_products(rng)
    by_cat = {}
    for p in products:
        by_cat.setdefault(p["category"], []).append(p)

    persona_defs = [
        # name, share, member_prob, touch seq choices, behavior, categories, sessions/visit range, purchase prob, repeat
        ("loyal_email", 0.10, 1.0, [["email_nl", "direct"], ["email_new", "direct"], ["email_new"], ["line", "email_nl", "direct"]],
         "search_deep", ["アウター", "ボトムス"], (3, 7), 0.65, 3),
        ("pmax_new", 0.20, 0.35, [["pmax"], ["pmax", "direct"], ["gsearch", "pmax"]],
         "quick", ["トップス", "アクセサリー"], (1, 3), 0.18, 0),
        ("line_feature", 0.10, 0.8, [["line", "organic"], ["line", "yahoo"], ["line"]],
         "content", ["シューズ", "バッグ"], (2, 5), 0.35, 1),
        ("ig_browse", 0.15, 0.3, [["ig_ad"], ["insta", "ig_ad"], ["ig_ad", "display"]],
         "browse", ["トップス", "バッグ"], (1, 4), 0.08, 0),
        ("organic", 0.25, 0.4, [["organic"], ["organic", "direct"], ["yahoo"], ["blog", "organic"]],
         "browse", list(CATEGORIES), (1, 4), 0.10, 1),
        ("sale_hunter", 0.10, 0.9, [["email_sale"], ["email_sale", "display"], ["display", "email_sale"]],
         "cart_heavy", ["ボトムス", "シューズ", "トップス"], (2, 4), 0.40, 1),
        ("drifter", 0.10, 0.1, [["direct"], ["organic"], ["insta"]],
         "bounce", list(CATEGORIES), (1, 2), 0.01, 0),
    ]
    n_people = 4200
    web_rows, members, pos_rows = [], [], []
    order_seq = 500000
    member_seq = 10000

    def pv(t, cookie, member, url, ref, ua, ecommerce=None):
        web_rows.append((t, cookie, member, url, ref, ua, json.dumps(ecommerce, ensure_ascii=False) if ecommerce else None))

    for i in range(n_people):
        r = rng.random()
        acc = 0
        for pd in persona_defs:
            acc += pd[1]
            if r <= acc:
                break
        name, _, member_prob, seqs, behavior, cats, sess_range, buy_p, repeat_n = pd
        cookie = f"ck-{i:06d}"
        is_member = rng.random() < member_prob
        member_id = None
        if is_member:
            member_seq += 1
            member_id = f"M{member_seq}"
            reg_days_ago = rng.randint(1, 900)
            age = rng.randint(19, 62)
            members.append((member_id, END - reg_days_ago * 86400, rng.choice(["女性", "女性", "男性", "回答しない"]),
                            datetime(2026 - age, rng.randint(1, 12), rng.randint(1, 28)).strftime("%Y-%m-%d"),
                            rng.choice(PREFS), 0 if rng.random() > 0.01 else 1))
        ua = rng.choice([
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari",
            "Mozilla/5.0 (Linux; Android 15; Pixel) Mobile Safari",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130",
        ])
        n_cycles = 1 + (repeat_n if rng.random() < 0.7 else 0)
        cycle_start = END - rng.randint(5, DAYS - 2) * 86400 + rng.randint(0, 86399)
        logged_in = False
        for cycle in range(n_cycles):
            seq = rng.choice(seqs)
            t = cycle_start
            purchased = False
            for si, kind in enumerate(seq):
                t += rng.randint(3600 * 6, 86400 * 4) if si > 0 else 0
                if t >= END - 60:
                    break
                cat = rng.choice(cats)
                prods = by_cat[cat]
                land_path = rng.choice(["/", f"/category/{cat}", f"/item/{rng.choice(prods)['product_id']}",
                                        "/feature/autumn-style" if behavior == "content" else "/"])
                url = landing_url(kind, land_path, rng)
                ref = referrer_for(kind)
                hits = [(url, ref)]
                prev = url
                steps = []
                last_step = si == len(seq) - 1
                if behavior == "search_deep":
                    steps = ["/search?q=" + cat] + [f"/item/{rng.choice(prods)['product_id']}" for _ in range(rng.randint(2, 5))]
                elif behavior == "quick":
                    steps = [f"/item/{rng.choice(prods)['product_id']}"]
                elif behavior == "content":
                    steps = ["/feature/autumn-style", "/feature/shoes-guide"] + [f"/item/{rng.choice(prods)['product_id']}" for _ in range(rng.randint(1, 3))]
                elif behavior == "browse":
                    steps = [f"/category/{cat}"] + [f"/item/{rng.choice(prods)['product_id']}" for _ in range(rng.randint(0, 2))]
                elif behavior == "cart_heavy":
                    steps = [f"/category/{cat}", f"/item/{rng.choice(prods)['product_id']}", "/cart", f"/item/{rng.choice(prods)['product_id']}", "/cart"]
                else:
                    steps = []
                for st in steps:
                    nxt = f"https://{HOST}{st}"
                    hits.append((nxt, prev))
                    prev = nxt
                # back/forward quirk: landing URL with utm re-recorded mid-session
                if TOUCHES[kind][0] in ("utm", "gclid") and len(steps) >= 2 and rng.random() < 0.35:
                    hits.append((url, f"https://{HOST}{steps[0]}"))
                    hits.append((f"https://{HOST}{steps[-1]}", url))
                will_buy = last_step and rng.random() < (buy_p if cycle == 0 else min(0.9, buy_p + 0.25))
                tt = t
                for (u, rf) in hits:
                    tt += rng.randint(15, 140)
                    pv(tt, cookie, member_id if logged_in else None, u, rf, ua)
                if will_buy and t < END - 3600:
                    basket = [rng.choice(by_cat[rng.choice(cats)]) for _ in range(rng.choice([1, 1, 1, 2, 3]))]
                    item_url = f"https://{HOST}/item/{basket[0]['product_id']}"
                    tt += rng.randint(20, 90)
                    pv(tt, cookie, member_id if logged_in else None, item_url, prev, ua)
                    tt += rng.randint(10, 60)
                    pv(tt, cookie, member_id if logged_in else None, f"https://{HOST}/cart", item_url, ua)
                    if is_member:
                        logged_in = True
                    tt += rng.randint(30, 120)
                    pv(tt, cookie, member_id, f"https://{HOST}/order/confirm", f"https://{HOST}/cart", ua)
                    order_seq += 1
                    oid = f"EC{order_seq}"
                    items = [{"item_id": p["product_id"], "item_name": p["product_name"], "item_category": p["category"],
                              "item_brand": p["brand"], "price": p["price"], "quantity": 1} for p in basket]
                    value = sum(p["price"] for p in basket)
                    pay_ref = rng.choice([f"https://{HOST}/order/confirm"] * 3 + ["https://www.paypay.ne.jp/app/cashier", "https://pay.rakuten.co.jp/checkout"])
                    tt += rng.randint(40, 200)
                    ec = {"transaction_id": oid, "value": value, "currency": "JPY", "items": items}
                    pv(tt, cookie, member_id, f"https://{HOST}/order/complete?order_id={oid}", pay_ref, ua, ec)
                    # thanks page reload
                    if rng.random() < 0.15:
                        pv(tt + 30, cookie, member_id, f"https://{HOST}/order/complete?order_id={oid}", f"https://{HOST}/order/complete?order_id={oid}", ua, ec)
                    if member_id:
                        for p in basket:
                            pos_rows.append((oid, member_id, tt, "EC", p["product_id"], 1, p["price"], "購入"))
                    purchased = True
            # store purchases for omni members
            if is_member and rng.random() < (0.35 if name in ("loyal_email", "sale_hunter", "line_feature") else 0.08):
                st_t = t + rng.randint(86400, 86400 * 20)
                if st_t < END - 3600:
                    order_seq += 1
                    p = rng.choice(by_cat[rng.choice(cats)])
                    pos_rows.append((f"ST{order_seq}", member_id, st_t, "SHOP01", p["product_id"], 1, p["price"], "購入"))
            # revisit after purchase
            if purchased and rng.random() < (0.8 if name == "loyal_email" else 0.3):
                rt = t + rng.randint(86400 * 2, 86400 * 20)
                if rt < END - 60:
                    pv(rt, cookie, member_id if logged_in else None, f"https://{HOST}/", None, ua)
                    pv(rt + 40, cookie, member_id if logged_in else None, f"https://{HOST}/mypage", f"https://{HOST}/", ua)
            cycle_start = t + rng.randint(86400 * 10, 86400 * 30)
            if cycle_start >= END - 86400:
                break
        # historical POS purchases (before the web window) for members
        if is_member and rng.random() < (0.85 if name in ("loyal_email",) else 0.35):
            for _ in range(rng.randint(1, 9 if name == "loyal_email" else 3)):
                order_seq += 1
                ht = END - rng.randint(DAYS + 1, 700) * 86400
                p = rng.choice(products)
                ch = rng.choice(["EC", "SHOP01", "SHOP02"])
                pos_rows.append(((ch[:2] if ch == "EC" else "ST") + str(order_seq), member_id, ht, ch, p["product_id"], 1, p["price"], "購入"))
        # cancelled order noise
        if is_member and rng.random() < 0.02:
            order_seq += 1
            pos_rows.append((f"ST{order_seq}", member_id, END - 5 * 86400, "SHOP02", products[0]["product_id"], 1, products[0]["price"], "キャンセル"))

    con = duckdb.connect(db_path)
    con.execute("CREATE SCHEMA IF NOT EXISTS src")
    con.execute("DROP TABLE IF EXISTS src.weblog_pageviews")
    con.execute("CREATE TABLE src.weblog_pageviews (time BIGINT, td_client_id VARCHAR, member_id VARCHAR, td_url VARCHAR, td_referrer VARCHAR, td_user_agent VARCHAR, ecommerce VARCHAR)")
    con.executemany("INSERT INTO src.weblog_pageviews VALUES (?, ?, ?, ?, ?, ?, ?)", web_rows)
    con.execute("DROP TABLE IF EXISTS src.crm_members")
    con.execute("CREATE TABLE src.crm_members (member_id VARCHAR, register_time BIGINT, gender VARCHAR, birthday VARCHAR, prefecture VARCHAR, is_test INTEGER)")
    con.executemany("INSERT INTO src.crm_members VALUES (?, ?, ?, ?, ?, ?)", members)
    con.execute("DROP TABLE IF EXISTS src.pos_order_lines")
    con.execute("CREATE TABLE src.pos_order_lines (order_id VARCHAR, member_id VARCHAR, time BIGINT, shop_code VARCHAR, product_id VARCHAR, qty INTEGER, amount DOUBLE, status VARCHAR)")
    con.executemany("INSERT INTO src.pos_order_lines VALUES (?, ?, ?, ?, ?, ?, ?, ?)", pos_rows)
    con.execute("DROP TABLE IF EXISTS src.product_master")
    con.execute("CREATE TABLE src.product_master (product_id VARCHAR, product_name VARCHAR, category VARCHAR, brand VARCHAR, price DOUBLE)")
    con.executemany("INSERT INTO src.product_master VALUES (?, ?, ?, ?, ?)",
                    [(p["product_id"], p["product_name"], p["category"], p["brand"], p["price"]) for p in products])
    for t in ["weblog_pageviews", "crm_members", "pos_order_lines", "product_master"]:
        print(t, con.execute(f"SELECT COUNT(*) FROM src.{t}").fetchone()[0])
    con.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "smoke.duckdb")
