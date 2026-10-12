#!/usr/bin/env node
// td-ec-golden-path-analytics CLI (Node.js 18+, no dependencies, never connects to Treasure Data)
//
//   node gp-cli.mjs check      <workflow dir>                         設定とWorkflowの静的検査
//   node gp-cli.mjs discovery-sql --params <params.yml> --out <dir>   データ確認用のSQL（読み取り専用）を書き出す
//   node gp-cli.mjs export-sql --db <database> --out <dir>             ダッシュボード用の抽出SQLを書き出す
//   node gp-cli.mjs bundle     --in <dir> --params <params.yml> --out <bundle.json> [--client <name>] [--project <name>] [--attempt <id>]
//   node gp-cli.mjs dashboard  --bundle <bundle.json> --out <file.html> [--template <html>]
//   node gp-cli.mjs validate   <bundle.json>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..')
const EXPORT_DIR = path.join(SKILL, 'export')
const DISCOVERY_DIR = path.join(SKILL, 'discovery')
const TEMPLATE = path.join(SKILL, 'assets', 'dashboard-template.html')
const FORMAT = 'td-ec-golden-path-analytics/bundle'
const VERSION = 1

// bundle keys → export SQL file name (export/<key>.sql); kpi is a single row
export const DATASETS = [
  'kpi', 'funnel', 'attribution_channel', 'attribution_touch', 'path_length', 'top_paths',
  'rfm_matrix', 'rfm_segments', 'golden_paths', 'golden_candidates',
  'loyal_product_paths', 'loyal_behavior_stats', 'ad_contribution', 'ad_product',
  'email_influence', 'email_product',
]
const REQUIRED = ['kpi', 'attribution_channel', 'rfm_matrix', 'golden_paths']

// columns that must stay strings even when they look numeric
const TEXT_KEYS = new Set([
  'product_id', 'product_name', 'product_group', 'category', 'brand', 'touch_key', 'channel', 'source', 'medium',
  'campaign', 'content', 'pattern', 'path_pattern', 'behavior_signature', 'channel_path', 'email_key', 'entry_key',
  'first_channel', 'member_id', 'person_key', 'bucket', 'metric', 'rfm_cell', 'segment', 'gender', 'age_band',
  'channel_mix', 'dimension', 'customer_type', 'pattern_type', 'strengths', 'order_id', 'cv_id',
])

// ---------------------------------------------------------------------------
// minimal YAML reader for params.yml (maps, scalars, quoted strings, inline lists, comments)
export function parseYaml(text) {
  const root = {}
  const stack = [{ indent: -1, obj: root }]
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.match(/^ */)[0].length
    const line = stripComment(raw.trim())
    if (!line) continue
    const m = line.match(/^([^:]+?):(?:\s+(.*))?$/)
    if (!m) throw new Error(`params.yml line ${i + 1}: cannot parse "${raw.trim()}"`)
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1].obj
    const key = m[1].trim()
    const rest = m[2]
    if (rest === undefined || rest === '') {
      parent[key] = {}
      stack.push({ indent, obj: parent[key] })
    } else {
      parent[key] = parseScalar(rest)
    }
  }
  return root
}

function stripComment(s) {
  let q = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '\\' && q === '"') { i++; continue }
      if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trim()
  }
  return s
}

function parseScalar(s) {
  s = s.trim()
  if (s.startsWith('"')) return JSON.parse(s)
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s.startsWith('[')) {
    const inner = s.slice(1, -1).trim()
    return inner ? splitTop(inner).map(parseScalar) : []
  }
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function splitTop(s) {
  const out = []
  let q = null, cur = ''
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === ',') { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function lookup(params, expr) {
  const neg = expr.startsWith('!')
  const parts = (neg ? expr.slice(1) : expr).match(/[^.[\]]+/g) || []
  let cur = params
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in cur)) return undefined
    cur = cur[p]
  }
  return neg ? !cur : cur
}

// ---------------------------------------------------------------------------
function args(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2)
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
      out[k] = v
    } else out._.push(argv[i])
  }
  return out
}

function walkFiles(dir, pred, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, pred, acc)
    else if (pred(p)) acc.push(p)
  }
  return acc
}

// ---------------------------------------------------------------------------
export function check(wfDir) {
  const errors = []
  const warnings = []
  const paramsPath = path.join(wfDir, 'config', 'params.yml')
  if (!fs.existsSync(paramsPath)) return { errors: [`${paramsPath} がありません`], warnings }
  const paramsText = fs.readFileSync(paramsPath, 'utf8')
  let params
  try { params = parseYaml(paramsText) } catch (e) { return { errors: [e.message], warnings } }

  // unresolved placeholders in params, only for parts that are used
  const tbc = []
  const visit = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) visit(v, key)
      else if (String(v).includes('<TO_BE_CONFIRMED>')) tbc.push(key)
    }
  }
  visit(params, '')
  for (const key of tbc) {
    const m = key.match(/^source\.(member|pos|product|id_map)\./)
    if (m && lookup(params, `source.${m[1]}.enabled`) === false) continue
    errors.push(`未確定の設定: ${key} = <TO_BE_CONFIRMED>`)
  }

  // ${...} references in dig and SQL
  const files = walkFiles(wfDir, (p) => p.endsWith('.sql') || p.endsWith('.dig'))
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const rel = path.relative(wfDir, f)
    for (const m of text.matchAll(/\$\{([^}]+)\}/g)) {
      const expr = m[1].trim()
      if (expr.startsWith('secret:') || ['session_date', 'session_time', 'session_unixtime'].includes(expr)) continue
      if (lookup(params, expr) === undefined) errors.push(`${rel}: 未定義のパラメータ \${${expr}}`)
    }
    if (f.endsWith('.dig')) {
      for (const m of text.matchAll(/^\s*(td|call)>:\s*(\S+)/gm)) {
        const target = path.resolve(path.dirname(f), m[2])
        if (!fs.existsSync(target)) errors.push(`${rel}: 参照先がありません ${m[2]}`)
      }
    }
  }
  if (!fs.existsSync(path.join(wfDir, 'tdx.json'))) warnings.push('tdx.json がありません（tdx wf push に必要）')

  // regexes must compile (Java and JS regex differ slightly; this catches obvious mistakes)
  const regexKeys = []
  const collect = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) collect(v, key)
      else if (k.endsWith('_regex') && typeof v === 'string' && !v.includes('<TO_BE_CONFIRMED>')) regexKeys.push([key, v])
    }
  }
  collect(params, '')
  for (const [key, re] of regexKeys) {
    try { new RegExp(re.replace(/^\(\?i\)/, '')) } catch (e) { errors.push(`正規表現が不正: ${key}: ${e.message}`) }
    if (re.includes("'")) errors.push(`正規表現にシングルクォートは使えません: ${key}`)
  }
  const w = ['w_cvr', 'w_loyalty', 'w_repeat', 'w_value', 'w_support'].map((k) => Number(lookup(params, `golden_path.${k}`)))
  if (w.some((x) => Number.isNaN(x) || x < 0) || w.reduce((a, b) => a + b, 0) <= 0) errors.push('golden_path の重み（w_*）は 0 以上で、合計が正の数である必要があります')
  const uf = Number(lookup(params, 'attribution.u_first')), ul = Number(lookup(params, 'attribution.u_last'))
  if (!(uf >= 0 && ul >= 0 && uf + ul <= 1)) errors.push('attribution.u_first + u_last は 1 以下にしてください')
  if (Number(lookup(params, 'common.weblog_lookback_days')) <= Number(lookup(params, 'journey.repurchase_window_days'))) {
    warnings.push('common.weblog_lookback_days が journey.repurchase_window_days 以下のため、再購入率が計算できません')
  }
  return { errors, warnings, params }
}

// ---------------------------------------------------------------------------
export function exportSql(db, outDir) {
  if (!/^[A-Za-z0-9_]+$/.test(db)) throw new Error(`database 名が不正です: ${db}`)
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  for (const key of DATASETS) {
    const src = path.join(EXPORT_DIR, `${key}.sql`)
    const sql = fs.readFileSync(src, 'utf8').replaceAll('{{database}}', db)
    const out = path.join(outDir, `${key}.sql`)
    fs.writeFileSync(out, sql)
    written.push(out)
  }
  return written
}

// ---------------------------------------------------------------------------
/** Render discovery SQL with params.yml. Queries that need unconfirmed values are skipped and reported. */
export function discoverySql(params, outDir, only) {
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  const skipped = []
  for (const name of fs.readdirSync(DISCOVERY_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const id = name.split('_')[0]
    if (only && !only.includes(id)) continue
    const text = fs.readFileSync(path.join(DISCOVERY_DIR, name), 'utf8')
    const missing = new Set()
    const sql = text.replace(/\$\{([^}]+)\}/g, (_m, expr) => {
      const v = lookup(params, expr.trim())
      if (v === undefined || String(v).includes('<TO_BE_CONFIRMED>')) { missing.add(expr.trim()); return _m }
      return typeof v === 'boolean' ? String(v) : String(v)
    })
    if (missing.size) { skipped.push({ name, missing: [...missing] }); continue }
    const out = path.join(outDir, name)
    fs.writeFileSync(out, sql)
    written.push(out)
  }
  return { written, skipped }
}

// ---------------------------------------------------------------------------
export function readRows(file) {
  const text = fs.readFileSync(file, 'utf8').trim()
  if (!text) return []
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // JSON Lines
    return text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  }
  if (Array.isArray(data)) {
    if (data.length && Array.isArray(data[0])) throw new Error(`${file}: 列名の無い配列形式です。--json で出力してください`)
    return data
  }
  const rows = data.rows || data.data || data.result || data.records
  const cols = data.columns || data.schema || data.fields
  if (Array.isArray(rows) && rows.length && Array.isArray(rows[0]) && Array.isArray(cols)) {
    const names = cols.map((c) => (typeof c === 'string' ? c : c.name))
    return rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])))
  }
  if (Array.isArray(rows)) return rows
  throw new Error(`${file}: 未対応の JSON 形式です`)
}

function normalizeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && !TEXT_KEYS.has(k) && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) out[k] = Number(v)
    else if (typeof v === 'number' && !Number.isFinite(v)) out[k] = null
    else out[k] = v
  }
  return out
}

function configSummary(params) {
  const g = (k) => lookup(params, k)
  const src = (k) => (g(`source.${k}.enabled`) === false ? null : `${g(`source.${k}.db`)}.${g(`source.${k}.table`)}`)
  return {
    sources: {
      weblog: `${g('source.weblog.db')}.${g('source.weblog.table')}`,
      member: src('member'),
      pos: src('pos'),
      product: src('product'),
      id_map: src('id_map'),
    },
    output_database: g('common.database'),
    id_stitching: g('common.id_stitching'),
    weblog_lookback_days: g('common.weblog_lookback_days'),
    pos_lookback_days: g('common.pos_lookback_days'),
    attribution: {
      grain: g('attribution.grain'),
      max_generations: g('attribution.max_generations'),
      lookback_days: g('attribution.lookback_days'),
      reset_after_conversion: g('attribution.reset_after_conversion'),
      decay_half_life_days: g('attribution.decay_half_life_days'),
      u_first: g('attribution.u_first'),
      u_last: g('attribution.u_last'),
    },
    touch: {
      session_timeout_minutes: g('touch.session_timeout_minutes'),
      collapse_mode: g('touch.collapse_mode'),
      exclude_referrer_regex: g('touch.exclude_referrer_regex'),
      exclude_utm_source_regex: g('touch.exclude_utm_source_regex'),
      exclude_hit_condition: g('touch.exclude_hit_condition'),
    },
    rfm: {
      scope: g('rfm.scope'),
      f_method: g('rfm.f_method'),
      f_thresholds: g('rfm.f_thresholds'),
      loyal_condition: g('rfm.loyal_condition'),
    },
    journey: {
      browse_min_pv: g('journey.browse_min_pv'),
      revisit_window_days: g('journey.revisit_window_days'),
      repurchase_window_days: g('journey.repurchase_window_days'),
    },
    email: { same_product_window_days: g('email.same_product_window_days') },
    golden_path: {
      product_level: g('golden_path.product_level'),
      path_steps: g('golden_path.path_steps'),
      behavior_steps: g('golden_path.behavior_steps'),
      behavior_exclude_regex: g('golden_path.behavior_exclude_regex'),
      min_support: g('golden_path.min_support'),
      prior_strength: g('golden_path.prior_strength'),
      lift_cap: g('golden_path.lift_cap'),
      weights: {
        cvr: g('golden_path.w_cvr'),
        loyalty: g('golden_path.w_loyalty'),
        repeat: g('golden_path.w_repeat'),
        value: g('golden_path.w_value'),
        support: g('golden_path.w_support'),
      },
      top_n: g('golden_path.top_n'),
      max_per_entry: g('golden_path.max_per_entry'),
    },
  }
}

export function buildBundle({ inDir, params, client, project, attempt }) {
  const bundle = {
    format: FORMAT,
    version: VERSION,
    meta: {
      client: client || '',
      generated_at: new Date().toISOString(),
      workflow: { project: project || '', attempt_id: attempt || '' },
      config: params ? configSummary(params) : {},
    },
  }
  const missing = []
  for (const key of DATASETS) {
    const f = path.join(inDir, `${key}.json`)
    if (!fs.existsSync(f)) { missing.push(key); bundle[key] = key === 'kpi' ? {} : []; continue }
    const rows = readRows(f).map(normalizeRow)
    bundle[key] = key === 'kpi' ? rows[0] || {} : rows
  }
  return { bundle, missing }
}

export function validateBundle(b) {
  const errors = []
  const warnings = []
  if (b.format !== FORMAT) errors.push(`format が ${FORMAT} ではありません`)
  if (b.version !== VERSION) errors.push(`version ${b.version} は未対応です`)
  for (const k of REQUIRED) {
    const v = b[k]
    if (v === undefined) errors.push(`${k} がありません`)
    else if (k === 'kpi' ? !Object.keys(v).length : !v.length) warnings.push(`${k} が空です`)
  }
  for (const k of DATASETS) if (b[k] === undefined) warnings.push(`${k} がありません`)
  const json = JSON.stringify(b)
  if (/(apikey|api_key|secret|password)\s*["']?\s*[:=]\s*["'][^"']{8,}/i.test(json)) errors.push('API キーやパスワードらしき値が含まれています')
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(json.replace(/"(touch_key|email_key|source|campaign|path_pattern|channel_path)":"[^"]*"/g, ''))) {
    warnings.push('メールアドレスらしき値が含まれています。個人情報が出力されていないか確認してください')
  }
  return { errors, warnings }
}

export function renderDashboard(bundle, templatePath = TEMPLATE) {
  const html = fs.readFileSync(templatePath, 'utf8')
  const marker = '<script id="gp-data" type="application/json">null</script>'
  if (!html.includes(marker)) throw new Error('テンプレートにデータ埋め込み位置がありません')
  const data = JSON.stringify(bundle).replace(/</g, '\\u003c')
  const title = bundle.meta?.client ? `${bundle.meta.client} ゴールデンパス分析` : 'ゴールデンパス分析'
  return html
    .replace(marker, () => `<script id="gp-data" type="application/json">${data}</script>`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title.replace(/[<&]/g, '')}</title>`)
}

// ---------------------------------------------------------------------------
function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = args(rest)
  try {
    switch (cmd) {
      case 'check': {
        const dir = a._[0] || '.'
        const { errors, warnings } = check(dir)
        warnings.forEach((w) => console.log(`warning: ${w}`))
        errors.forEach((e) => console.log(`error:   ${e}`))
        console.log(errors.length ? `NG（エラー ${errors.length} 件）` : `OK（警告 ${warnings.length} 件）`)
        process.exit(errors.length ? 1 : 0)
        break
      }
      case 'discovery-sql': {
        if (!a.params || !a.out) throw new Error('--params と --out を指定してください')
        const params = parseYaml(fs.readFileSync(a.params, 'utf8'))
        const only = typeof a.only === 'string' ? a.only.split(',').map((x) => x.trim().toLowerCase()) : null
        const { written, skipped } = discoverySql(params, a.out, only)
        written.forEach((f) => console.log(f))
        skipped.forEach((x) => console.log(`skip: ${x.name}（未確定: ${x.missing.join(', ')}）`))
        break
      }
      case 'export-sql': {
        if (!a.db || !a.out) throw new Error('--db と --out を指定してください')
        const files = exportSql(a.db, a.out)
        files.forEach((f) => console.log(f))
        break
      }
      case 'bundle': {
        if (!a.in || !a.out) throw new Error('--in と --out を指定してください')
        const params = a.params ? parseYaml(fs.readFileSync(a.params, 'utf8')) : null
        const { bundle, missing } = buildBundle({ inDir: a.in, params, client: a.client, project: a.project, attempt: a.attempt })
        const { errors, warnings } = validateBundle(bundle)
        missing.forEach((m) => console.log(`warning: ${m}.json がありません`))
        warnings.forEach((w) => console.log(`warning: ${w}`))
        errors.forEach((e) => console.log(`error:   ${e}`))
        if (errors.length) process.exit(1)
        fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true })
        fs.writeFileSync(a.out, JSON.stringify(bundle))
        console.log(`${a.out}（${(fs.statSync(a.out).size / 1024).toFixed(0)} KB）`)
        break
      }
      case 'dashboard': {
        if (!a.bundle || !a.out) throw new Error('--bundle と --out を指定してください')
        const bundle = JSON.parse(fs.readFileSync(a.bundle, 'utf8'))
        const { errors } = validateBundle(bundle)
        if (errors.length) throw new Error(errors.join('\n'))
        fs.writeFileSync(a.out, renderDashboard(bundle, a.template || TEMPLATE))
        console.log(`${a.out}（${(fs.statSync(a.out).size / 1024).toFixed(0)} KB）`)
        break
      }
      case 'validate': {
        const bundle = JSON.parse(fs.readFileSync(a._[0], 'utf8'))
        const { errors, warnings } = validateBundle(bundle)
        warnings.forEach((w) => console.log(`warning: ${w}`))
        errors.forEach((e) => console.log(`error:   ${e}`))
        console.log(errors.length ? 'NG' : 'OK')
        process.exit(errors.length ? 1 : 0)
        break
      }
      default:
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith('//'))).join('\n').replace(/^\/\/ ?/gm, ''))
        process.exit(cmd ? 1 : 0)
    }
  } catch (e) {
    console.error(`error: ${e.message}`)
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
