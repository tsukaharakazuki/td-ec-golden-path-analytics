#!/usr/bin/env node
// td-ec-golden-path-analytics CLI (Node.js 18+, no dependencies, never connects to Treasure Data)
//
//   node gp-cli.mjs check      <workflow dir>                         設定とWorkflowの静的検査
//   node gp-cli.mjs discovery-sql --params <params.yml> --out <dir>   データ確認用のSQL（読み取り専用）を書き出す
//   node gp-cli.mjs export-sql --db <database> --out <dir>             ダッシュボード用の抽出SQLを書き出す
//   node gp-cli.mjs bundle     --in <dir> --params <params.yml> --out <bundle.json> [--client <name>] [--project <name>] [--attempt <id>]
//   node gp-cli.mjs dashboard  --bundle <bundle.json> --out <file.html> [--template <html>] [--by <担当者>]
//   node gp-cli.mjs validate   <bundle.json>
//   node gp-cli.mjs memory     <作業フォルダ> --by <担当者> --stage <段階> --summary <要約> [--status 進行中|完了|中断] [--done ..] [--decided ..] [--open ..] [--next ..]
//                                                                     作業記録 <作業フォルダ>/MEMORY.md に時系列で追記する（無ければ作る）
//
// 作業フォルダは Treasure AI Studio の「my」以外の共有フォルダに置く（my は本人しか開けない）。
// 書き出し系のコマンドは、出力先が my の中だとエラーにする。
// dashboard は、出力先の上位フォルダに MEMORY.md があれば 1 行追記する（--by で担当者）。
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
  'freq_links', 'freq_nodes', 'freq_outcome', 'freq_combos',
]
const REQUIRED = ['kpi', 'attribution_channel', 'rfm_matrix', 'golden_paths']

// columns that must stay strings even when they look numeric
const TEXT_KEYS = new Set([
  'product_id', 'product_name', 'product_group', 'category', 'brand', 'touch_key', 'channel', 'source', 'medium',
  'campaign', 'content', 'pattern', 'path_pattern', 'behavior_signature', 'channel_path', 'email_key', 'entry_key',
  'first_channel', 'member_id', 'person_key', 'bucket', 'metric', 'rfm_cell', 'segment', 'gender', 'age_band',
  'channel_mix', 'dimension', 'customer_type', 'pattern_type', 'strengths', 'order_id', 'cv_id',
  'mode', 'kind', 'node', 'from_node', 'to_node', 'final_node', 'combo', 'dimension_label',
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
// Shared folders and MEMORY.md
//
// Treasure AI Studio gives every user a private "my" folder that nobody else can open.
// The Workflow project, reports, dashboards, the installed skill and the work log are
// shared with the team, so they must never be written there.

export const PRIVATE_FOLDER = /^my$/i
export const WORK_FOLDER = 'golden-path'

export function privateFolderOf(p) {
  const parts = path.resolve(p).split(path.sep)
  const index = parts.findIndex((part) => PRIVATE_FOLDER.test(part))
  return index < 0 ? undefined : parts.slice(0, index + 1).join(path.sep) || path.sep
}

export function assertSharedPath(p, label = '出力先') {
  const folder = privateFolderOf(p)
  if (folder) {
    throw new Error(`${label}（${path.resolve(p)}）は「my」フォルダ（${folder}）の中です。my は本人しか開けず他のメンバーと共有できないため、my 以外のフォルダ（例: ${path.join(path.dirname(folder), WORK_FOLDER)}）を作成し、その中で作業してください`)
  }
}

export const MEMORY_FILE = 'MEMORY.md'

const MEMORY_HEADER = `# MEMORY — ECゴールデンパス分析 作業記録

ゴールデンパス分析の構築・運用は段階を分けて、担当者をまたいで進めます。このファイルには **時系列（古い順）** で作業を追記します。
作業を始める人は **最後のエントリ** から「状態」「未解決・要確認」「次にやること」を読んで引き継いでください。

- 追記は \`node gp-cli.mjs memory <作業フォルダ> --by <担当者> --stage <段階> --summary <要約> ...\` で行う（dashboard は自動で 1 行追記する）
- 過去のエントリは書き換えない。訂正は新しいエントリで行う
- API キー・トークン・Webhook URL・個人情報の生値・クエリ結果の生データは書かない
- このフォルダは「my」以外の共有フォルダに置く（my は本人しか開けない）

`

const SECRET_PATTERNS = [
  [/\b\d{3,6}\/[0-9a-f]{40}\b/i, 'TD の API キー'],
  [/https:\/\/hooks\.(slack|zapier)\.com\/\S+/i, 'Webhook URL'],
  [/\b(api[_-]?key|apikey|token|password|secret)\s*[:=]\s*\S{8,}/i, 'API キー・パスワード'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'メールアドレス'],
]

function stamp(at) {
  if (typeof at === 'string') return at
  const date = new Date()
  const offset = -date.getTimezoneOffset()
  const pad = (v) => String(Math.trunc(Math.abs(v))).padStart(2, '0')
  const local = new Date(date.getTime() + offset * 60000).toISOString()
  return `${local.slice(0, 10)} ${local.slice(11, 16)} (${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)})`
}

const bullets = (v) => (typeof v === 'string' ? v.split(/\r?\n/).map((l) => l.replace(/^\s*[-*・]\s*/, '').trim()).filter(Boolean) : [])

export function memoryEntry({ at, by, stage, status, summary, done, decided, open, next }) {
  const lines = [`## ${stamp(at)} — ${stage || '作業'} — 担当: ${typeof by === 'string' && by ? by : '（未記入）'}`, '']
  if (typeof status === 'string' && status) lines.push(`- 状態: ${status}`)
  for (const l of bullets(summary)) lines.push(`- ${l}`)
  for (const [title, v] of [['実施したこと', done], ['決定・確認済み', decided], ['未解決・要確認', open], ['次にやること', next]]) {
    const items = bullets(v)
    if (items.length) lines.push('', `### ${title}`, '', ...items.map((x) => `- ${x}`))
  }
  return `${lines.join('\n')}\n\n`
}

/** Append an entry to <workDir>/MEMORY.md, creating it (and the folder) if needed. */
export function appendMemory(workDir, entry, { create = true } = {}) {
  const file = path.join(path.resolve(workDir), MEMORY_FILE)
  assertSharedPath(file, 'MEMORY.md')
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(JSON.stringify(entry))) throw new Error(`MEMORY.md に書こうとした内容に${label}が含まれている可能性があります。書き込みを中止しました`)
  }
  if (!fs.existsSync(file)) {
    if (!create) return undefined
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, MEMORY_HEADER)
  }
  const text = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, `${text.replace(/\n*$/, '\n\n')}${memoryEntry(entry)}`.replace(/\n{3,}/g, '\n\n'))
  return file
}

/** The work folder of a file: the nearest ancestor that holds MEMORY.md. */
export function findWorkDir(p) {
  let dir = path.dirname(path.resolve(p))
  for (;;) {
    if (fs.existsSync(path.join(dir, MEMORY_FILE))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

// ---------------------------------------------------------------------------
export function check(wfDir) {
  const errors = []
  const warnings = []
  const privateFolder = privateFolderOf(wfDir)
  if (privateFolder) errors.push(`Workflow プロジェクトが「my」フォルダ（${privateFolder}）の中にあります。my は他のメンバーと共有できないため、my 以外の作業フォルダ（例: ${path.join(path.dirname(privateFolder), WORK_FOLDER)}）に置いてください`)
  else if (!findWorkDir(path.join(path.resolve(wfDir), 'x')) && !path.resolve(wfDir).startsWith(SKILL)) warnings.push(`作業フォルダに ${MEMORY_FILE} がありません（作業記録を残すには gp-cli.mjs memory <作業フォルダ> ... で作成）`)
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
  errors.push(...checkFrequency(params))
  if (Number(lookup(params, 'common.weblog_lookback_days')) <= Number(lookup(params, 'journey.repurchase_window_days'))) {
    warnings.push('common.weblog_lookback_days が journey.repurchase_window_days 以下のため、再購入率が計算できません')
  }
  return { errors, warnings, params }
}

const FREQ_DIMENSIONS = ['category', 'brand', 'amount_band', 'channel', 'custom']

/** frequency_sankey の設定の検査（区切りの昇順、ランク名の数、SQL の文字列に埋め込む値のクォート） */
export function checkFrequency(params) {
  const f = lookup(params, 'frequency_sankey')
  if (f === undefined) return []
  const errors = []
  const nums = (key) => {
    const raw = String(f[key] ?? '').split(',').map((x) => x.trim())
    const vals = raw.map(Number)
    if (!raw.length || raw.some((x) => x === '') || vals.some((x) => !Number.isFinite(x) || x < 0)) {
      errors.push(`frequency_sankey.${key} はカンマ区切りの 0 以上の数値にしてください: "${f[key]}"`)
      return null
    }
    if (vals.some((x, i) => i > 0 && x <= vals[i - 1])) errors.push(`frequency_sankey.${key} は昇順（重複なし）にしてください`)
    return vals
  }
  const steps = Number(f.max_steps)
  if (!Number.isInteger(steps) || steps < 2 || steps > 10) errors.push('frequency_sankey.max_steps は 2〜10 の整数にしてください')
  const dims = String(f.dimensions ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  if (!dims.length) errors.push('frequency_sankey.dimensions が空です')
  for (const d of dims) if (!FREQ_DIMENSIONS.includes(d)) errors.push(`frequency_sankey.dimensions に未対応の軸があります: ${d}（${FREQ_DIMENSIONS.join(' / ')}）`)
  if (dims.includes('custom') && /^\s*CAST\(NULL AS VARCHAR\)\s*$/i.test(String(f.custom_expr))) errors.push('frequency_sankey.dimensions に custom がありますが、custom_expr が未設定です')
  if (!['primary', 'mixed', 'split'].includes(f.multi_mode_default)) errors.push('frequency_sankey.multi_mode_default は primary / mixed / split のいずれかです')
  if (!['all', 'ec'].includes(f.scope)) errors.push('frequency_sankey.scope は all / ec のいずれかです')
  if (!['amount_rank', 'rfm_segment', 'none'].includes(f.final_column)) errors.push('frequency_sankey.final_column は amount_rank / rfm_segment / none のいずれかです')
  const topN = Number(f.top_nodes)
  if (!Number.isInteger(topN) || topN < 1 || topN > 12) errors.push('frequency_sankey.top_nodes は 1〜12 の整数にしてください（多すぎると図が読めなくなります）')
  if (!(Number(f.new_customer_gap_days) >= 0)) errors.push('frequency_sankey.new_customer_gap_days は 0 以上にしてください')
  nums('amount_bands')
  const th = nums('rank_thresholds')
  if (f.final_column === 'amount_rank' && th) {
    const labels = String(f.rank_labels ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    if (labels.length !== th.length + 1) errors.push(`frequency_sankey.rank_labels は rank_thresholds の数 + 1（${th.length + 1} 個）にしてください（いまは ${labels.length} 個）`)
  }
  for (const k of ['dimensions', 'amount_bands', 'rank_thresholds', 'rank_labels', 'custom_label', 'scope', 'final_column']) {
    if (String(f[k] ?? '').includes("'")) errors.push(`frequency_sankey.${k} にシングルクォートは使えません`)
  }
  return errors
}

// ---------------------------------------------------------------------------
export function exportSql(db, outDir) {
  if (!/^[A-Za-z0-9_]+$/.test(db)) throw new Error(`database 名が不正です: ${db}`)
  assertSharedPath(outDir, 'SQL の出力先')
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
  assertSharedPath(outDir, 'SQL の出力先')
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
    frequency_sankey: g('frequency_sankey') === undefined ? null : {
      enabled: g('frequency_sankey.enabled'),
      max_steps: g('frequency_sankey.max_steps'),
      dimensions: String(g('frequency_sankey.dimensions') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      new_customer_gap_days: g('frequency_sankey.new_customer_gap_days'),
      scope: g('frequency_sankey.scope'),
      top_nodes: g('frequency_sankey.top_nodes'),
      multi_mode_default: g('frequency_sankey.multi_mode_default'),
      amount_bands: g('frequency_sankey.amount_bands'),
      custom_label: g('frequency_sankey.custom_label'),
      final_column: g('frequency_sankey.final_column'),
      rank_thresholds: g('frequency_sankey.rank_thresholds'),
      rank_labels: g('frequency_sankey.rank_labels'),
      rank_title: g('frequency_sankey.rank_title'),
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
        assertSharedPath(a.out, 'bundle の出力先')
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
        assertSharedPath(a.out, 'ダッシュボードの出力先')
        fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true })
        fs.writeFileSync(a.out, renderDashboard(bundle, a.template || TEMPLATE))
        console.log(`${a.out}（${(fs.statSync(a.out).size / 1024).toFixed(0)} KB）`)
        const workDir = findWorkDir(a.out)
        if (workDir) {
          const k = bundle.kpi || {}
          const day = (t) => (Number(t) > 0 ? new Date(Number(t) * 1000).toISOString().slice(0, 10) : '')
          const wf = bundle.meta?.workflow || {}
          const facts = [
            wf.project && `project ${wf.project}`,
            wf.attempt_id && `attempt ${wf.attempt_id}`,
            k.web_from && `Webログ ${day(k.web_from)}〜${day(k.web_to)}`,
            k.conversions != null && `CV ${k.conversions}`,
            k.revenue != null && `売上 ${Math.round(Number(k.revenue)).toLocaleString('ja-JP')}`,
          ].filter(Boolean)
          appendMemory(workDir, {
            by: a.by, stage: 'ダッシュボード作成', status: '完了',
            summary: `${path.relative(workDir, path.resolve(a.out)).split(path.sep).join('/')} を作成${facts.length ? `（${facts.join(' / ')}）` : ''}`,
          })
          console.log(`作業記録: ${path.join(workDir, MEMORY_FILE)} に追記しました`)
        }
        break
      }
      case 'memory': {
        const dir = a._[0]
        if (!dir || typeof a.stage !== 'string' || typeof a.summary !== 'string') throw new Error('memory <作業フォルダ> --by <担当者> --stage <段階> --summary <要約> を指定してください')
        const file = appendMemory(dir, { at: a.at, by: a.by, stage: a.stage, status: a.status, summary: a.summary, done: a.done, decided: a.decided, open: a.open, next: a.next })
        console.log(`${file} に追記しました`)
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
