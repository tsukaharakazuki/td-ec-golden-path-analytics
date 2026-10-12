// Bundle format: docs/BUNDLE_FORMAT.md
export type Row = Record<string, string | number | null>

export interface Bundle {
  format: string
  version: number
  meta: {
    client?: string
    generated_at?: string
    workflow?: { project?: string; attempt_id?: string }
    config?: Record<string, any>
  }
  kpi: Row
  funnel: Row[]
  attribution_channel: Row[]
  attribution_touch: Row[]
  path_length: Row[]
  top_paths: Row[]
  rfm_matrix: Row[]
  rfm_segments: Row[]
  golden_paths: Row[]
  golden_candidates: Row[]
  loyal_product_paths: Row[]
  loyal_behavior_stats: Row[]
  ad_contribution: Row[]
  ad_product: Row[]
  email_influence: Row[]
  email_product: Row[]
}

export const FORMAT = 'td-ec-golden-path-analytics/bundle'
const LISTS = [
  'funnel', 'attribution_channel', 'attribution_touch', 'path_length', 'top_paths', 'rfm_matrix', 'rfm_segments',
  'golden_paths', 'golden_candidates', 'loyal_product_paths', 'loyal_behavior_stats', 'ad_contribution', 'ad_product',
  'email_influence', 'email_product',
] as const

export function parseBundle(raw: unknown): Bundle {
  if (!raw || typeof raw !== 'object') throw new Error('JSON ではありません')
  const b = raw as Bundle
  if (b.format !== FORMAT) throw new Error('ゴールデンパス分析のデータファイル（bundle.json）ではありません')
  if (b.version !== 1) throw new Error(`未対応のバージョンです（version ${b.version}）`)
  for (const k of LISTS) if (!Array.isArray((b as any)[k])) (b as any)[k] = []
  if (!b.kpi || typeof b.kpi !== 'object') b.kpi = {}
  b.meta = b.meta || {}
  return b
}

export function embeddedBundle(): Bundle | null {
  const el = document.getElementById('gp-data')
  if (!el || !el.textContent || el.textContent.trim() === 'null') return null
  return parseBundle(JSON.parse(el.textContent))
}

// ---------------------------------------------------------------------------
export const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return NaN
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : NaN
}
export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

const nf0 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

export function fmtInt(v: unknown): string {
  const n = num(v)
  return Number.isNaN(n) ? '—' : nf0.format(Math.round(n))
}
export function fmtDec(v: unknown, digits = 1): string {
  const n = num(v)
  if (Number.isNaN(n)) return '—'
  return digits === 1 ? nf1.format(n) : n.toFixed(digits)
}
export function fmtPct(v: unknown, digits = 1): string {
  const n = num(v)
  return Number.isNaN(n) ? '—' : `${(n * 100).toFixed(digits)}%`
}
export function fmtYen(v: unknown): string {
  const n = num(v)
  if (Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1e8) return `¥${(n / 1e8).toFixed(2)}億`
  if (Math.abs(n) >= 1e4) return `¥${nf0.format(Math.round(n / 1e4))}万`
  return `¥${nf0.format(Math.round(n))}`
}
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}億`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}千`
  return nf0.format(n)
}
export function fmtLift(v: unknown): string {
  const n = num(v)
  return Number.isNaN(n) ? '—' : `×${n.toFixed(2)}`
}
export function fmtDate(unix: unknown): string {
  const n = num(unix)
  if (Number.isNaN(n)) return '—'
  const d = new Date(n * 1000)
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' })
}

// ---------------------------------------------------------------------------
export const PAGE_LABELS: Record<string, string> = {
  top: 'トップ',
  category: 'カテゴリ',
  search: '検索',
  pdp: '商品詳細',
  cart: 'カート',
  checkout: '購入手続き',
  register: '会員登録',
  mypage: 'マイページ',
  content: '特集・記事',
  other: 'その他',
  cv: '購入完了',
}

export interface Step { label: string; count?: string; kind: 'channel' | 'page' | 'more' }

export function pathSteps(pattern: unknown): Step[] {
  const s = str(pattern)
  if (!s) return []
  return s.split(' > ').map((p) => (p === '…' ? { label: '…', kind: 'more' } : { label: p, kind: 'channel' }))
}

export function behaviorSteps(sig: unknown): Step[] {
  const s = str(sig)
  if (!s) return []
  return s.split(' > ').map((p) => {
    if (p === '…') return { label: '…', kind: 'more' as const }
    const m = p.match(/^([a-z_]+)(×(\d\+?))?$/)
    if (!m) return { label: p, kind: 'page' as const }
    return { label: PAGE_LABELS[m[1]] || m[1], count: m[3] ? `×${m[3]}` : undefined, kind: 'page' as const }
  })
}

export function behaviorText(sig: unknown): string {
  return behaviorSteps(sig).map((s) => s.label + (s.count || '')).join(' → ')
}
export function pathText(pattern: unknown): string {
  return str(pattern).split(' > ').join(' → ')
}

export const PATTERN_TYPES: { id: string; label: string; help: string }[] = [
  { id: 'full', label: '経路 × 行動 × 商品', help: '流入経路・サイト内行動・購入した商品グループの組み合わせ' },
  { id: 'acquisition_product', label: '経路 × 商品', help: 'どの流入経路から、どの商品グループが買われたか' },
  { id: 'onsite_product', label: '行動 × 商品', help: 'どのサイト内行動で、どの商品グループが買われたか' },
  { id: 'acquisition', label: '流入経路', help: '流入経路（直近のチャネルの並び）だけで評価' },
  { id: 'onsite', label: 'サイト内行動', help: '購入セッションのページ種別の並びだけで評価' },
]

export const COMPONENTS: { id: string; col: string; lift: string; label: string; help: string }[] = [
  { id: 'cvr', col: 'c_cvr', lift: 'cvr_lift', label: 'CVR', help: '経路の CVR（未 CV の経路を含む）と行動の CVR の全体比' },
  { id: 'loyalty', col: 'c_loyalty', lift: 'loyalty_lift', label: 'ロイヤル率', help: '購入者に占めるロイヤル顧客（RFM）の比率の全体比' },
  { id: 'repeat', col: 'c_repeat', lift: 'repeat_lift', label: '再購入率', help: '購入後の再購入率の全体比' },
  { id: 'value', col: 'c_value', lift: 'value_index', label: '客単価', help: '1 CV あたり売上の全体比' },
  { id: 'support', col: 'c_support', lift: 'conversions', label: 'CV 数', help: 'その種別で最も多い候補を基準にした CV 数の多さ' },
]

export const MODELS: { id: string; label: string; help: string }[] = [
  { id: 'last', label: 'ラストクリック', help: '購入直前のタッチにすべて' },
  { id: 'first', label: 'ファーストクリック', help: '最初のタッチにすべて' },
  { id: 'linear', label: '線形', help: 'すべてのタッチに均等' },
  { id: 'decay', label: '逓減', help: '購入に近いタッチほど大きく（半減期で減衰）' },
  { id: 'u', label: 'U字', help: '最初と最後に大きく、中間に残りを均等' },
]

export function sumBy(rows: Row[], col: string): number {
  return rows.reduce((a, r) => a + (Number.isNaN(num(r[col])) ? 0 : num(r[col])), 0)
}
