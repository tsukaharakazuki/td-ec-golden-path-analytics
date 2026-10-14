// Frequency sankey: how the purchase (category / brand / order value …) shifts from the 1st to the Nth order,
// ending in the cumulative-spend rank (or RFM segment) after the Nth order.
import { useMemo, useState } from 'react'
import { EChart, baseOption, useTheme, type Theme } from './charts'
import { fmtInt, fmtPct, fmtYen, num, str, type Bundle, type Row } from './data'
import { DataTable, Empty, Section, Segmented, Select, Stat } from './ui'

type Mode = 'primary' | 'mixed' | 'split'
type Pop = 'reached' | 'all'

const MULTI_DIMS = new Set(['category', 'brand', 'custom'])
const EXIT = '(離脱)'
const OTHER = 'その他'
const MULTI_COLOR = '#c08a00'
const CHART_H = 560
const isMulti = (v: string) => v.startsWith('複数')

const DIM_LABELS: Record<string, string> = {
  category: '商品カテゴリ',
  brand: 'ブランド',
  amount_band: '1注文の金額',
  channel: '購入チャネル',
}
const DIM_NOUN: Record<string, string> = { category: 'カテゴリ', brand: 'ブランド' }

export const MODES: { id: Mode; label: string; help: string; note: string }[] = [
  {
    id: 'primary', label: '金額最大の値', help: '1注文で複数の値を買ったときは、金額が最も大きい値をその注文の値にします',
    note: '1注文で複数を買ったときは、金額が最も大きいものをその回の値にしています。人数がそのまま保たれ、「主に何を買ったか」の流れが見えます。',
  },
  {
    id: 'mixed', label: '「複数」にまとめる', help: '2つ以上の値を買った注文を「複数〜」という1つの値にまとめます',
    note: '1注文で2つ以上を買った回は「複数〜」にまとめています。まとめ買い・併買がどの回で増えるか、その人がどこへ流れるかが見えます。中身は下の「組み合わせ」で確認できます。',
  },
  {
    id: 'split', label: '金額比で按分', help: '1人の注文を、値ごとの金額の比率で分けて流します（人数は「人相当」）',
    note: '1注文を値ごとの金額比で分けて流しています（例: アウター 2万円 + トップス 5千円 → 0.8 人 + 0.2 人）。すべての値が図に出ますが、人数は「人相当」です。',
  },
]

function dimLabel(dim: string, cfg: any) {
  return dim === 'custom' ? str(cfg?.custom_label) || 'カスタム' : DIM_LABELS[dim] || dim
}

interface Pal { node: (v: string) => string }

function palette(t: Theme, values: { node: string; order: number }[], finals: { node: string; order: number }[]): Pal {
  const map = new Map<string, string>()
  values.filter((v) => v.node !== OTHER && !isMulti(v.node) && v.node !== EXIT)
    .sort((a, b) => a.order - b.order || a.node.localeCompare(b.node, 'ja'))
    .forEach((v, i) => map.set(v.node, t.series[i % t.series.length]))
  const fs = [...finals].sort((a, b) => a.order - b.order)
  fs.forEach((f, i) => {
    const idx = fs.length === 1 ? 5 : Math.round(2 + (i * 4) / (fs.length - 1))
    map.set(`final:${f.node}`, t.seq[Math.min(6, idx)])
  })
  return {
    node: (key: string) => {
      if (map.has(key)) return map.get(key)!
      const v = key.replace(/^final:/, '')
      if (v === EXIT) return t.grid
      if (v === OTHER) return t.axis
      if (isMulti(v)) return MULTI_COLOR
      return t.muted
    },
  }
}

export function Frequency({ b }: { b: Bundle }) {
  const t = useTheme()
  const cfg = b.meta.config?.frequency_sankey || {}
  const dims = useMemo(() => {
    const present = new Set(b.freq_nodes.map((r) => str(r.dimension)))
    const order: string[] = Array.isArray(cfg.dimensions) && cfg.dimensions.length ? cfg.dimensions : ['category', 'brand', 'custom', 'amount_band', 'channel']
    const out = order.filter((d) => present.has(d))
    present.forEach((d) => { if (!out.includes(d)) out.push(d) })
    return out
  }, [b, cfg])
  const [dim, setDim] = useState(dims[0] || 'category')
  const [mode, setMode] = useState<Mode>(MODES.some((m) => m.id === cfg.multi_mode_default) ? cfg.multi_mode_default : 'primary')
  const [pop, setPop] = useState<Pop>('reached')
  const multiDim = MULTI_DIMS.has(dim)
  const unit = multiDim && mode === 'split' ? '人相当' : '人'

  const pick = (r: Row) => str(r.dimension) === dim && (str(r.mode) === 'single' || str(r.mode) === mode)
  const nodes = useMemo(() => b.freq_nodes.filter(pick), [b, dim, mode])
  const links = useMemo(() => b.freq_links.filter(pick), [b, dim, mode])
  const outcome = useMemo(() => b.freq_outcome.filter(pick), [b, dim, mode])

  const maxStep = useMemo(() => {
    const n = Number(cfg.max_steps)
    if (Number.isInteger(n) && n > 1) return n
    return Math.max(1, ...links.filter((l) => str(l.kind) !== 'final').map((l) => num(l.step) + 1))
  }, [links, cfg])
  const finalTitle = cfg.final_column === 'rfm_segment' ? 'RFM セグメント' : str(cfg.rank_title) || '累計購買金額ランク'
  const hasFinal = links.some((l) => str(l.kind) === 'final')

  // Final column values, best first
  const finals = useMemo(() => {
    const m = new Map<string, { node: string; order: number; weight: number; amount: number }>()
    for (const r of nodes) {
      if (num(r.step) !== maxStep + 1) continue
      const k = str(r.node)
      const cur = m.get(k) || { node: k, order: num(r.node_order), weight: 0, amount: 0 }
      cur.weight += num(r.weight) || 0
      cur.amount += num(r.amount) || 0
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => b.order - a.order)
  }, [nodes, maxStep])

  const pal = useMemo(() => {
    const vals = new Map<string, number>()
    for (const r of nodes) if (num(r.step) <= maxStep) vals.set(str(r.node), Math.min(vals.get(str(r.node)) ?? Infinity, num(r.node_order)))
    return palette(t, [...vals].map(([node, order]) => ({ node, order })), finals)
  }, [t, nodes, finals, maxStep])

  // Node stats for the tooltip (by column)
  const stat = useMemo(() => {
    const m = new Map<string, { weight: number; multi: number; amount: number; customers: number }>()
    for (const r of nodes) {
      if (pop === 'reached' && num(r.reached) !== 1) continue
      const key = `${num(r.step)}|${str(r.node)}`
      const cur = m.get(key) || { weight: 0, multi: 0, amount: 0, customers: 0 }
      cur.weight += num(r.weight) || 0
      cur.multi += num(r.multi_weight) || 0
      cur.amount += num(r.amount) || 0
      cur.customers += num(r.customers) || 0
      m.set(key, cur)
    }
    return m
  }, [nodes, pop])

  const sankey = useMemo(() => {
    const use = links.filter((l) => (pop === 'reached' ? num(l.reached) === 1 && str(l.kind) !== 'exit' : true))
    if (!use.length) return null
    const nodeMap = new Map<string, { col: number; value: string; order: number; total: number }>()
    const colTotal = new Map<number, number>()
    const add = (col: number, value: string, order: number, w: number, isTarget: boolean) => {
      const id = `${col}|${value}`
      const cur = nodeMap.get(id) || { col, value, order, total: 0 }
      cur.order = Math.min(cur.order, order)
      nodeMap.set(id, cur)
      // node totals: incoming for targets, outgoing for the first column
      if (isTarget || col === 1) { cur.total += w; colTotal.set(col, (colTotal.get(col) || 0) + w) }
    }
    const edgeMap = new Map<string, { source: string; target: string; value: number; customers: number }>()
    for (const l of use) {
      const step = num(l.step)
      const from = str(l.from_node), to = str(l.to_node)
      const w = num(l.weight) || 0
      if (w <= 0) continue
      add(step, from, num(l.from_order), w, false)
      add(step + 1, to, num(l.to_order), w, true)
      const key = `${step}|${from}→${step + 1}|${to}`
      const cur = edgeMap.get(key) || { source: `${step}|${from}`, target: `${step + 1}|${to}`, value: 0, customers: 0 }
      cur.value += w
      cur.customers += num(l.customers) || 0
      edgeMap.set(key, cur)
    }
    const cols = Math.max(...[...nodeMap.values()].map((n) => n.col))
    const ordered = [...nodeMap.entries()].sort(([, a], [, b2]) => {
      if (a.col !== b2.col) return a.col - b2.col
      const fa = a.col === maxStep + 1, fb = b2.col === maxStep + 1
      if (fa && fb) return b2.order - a.order // best rank on top
      return a.order - b2.order || a.value.localeCompare(b2.value, 'ja')
    })
    return { nodes: ordered, edges: [...edgeMap.values()], cols, colTotal }
  }, [links, pop, maxStep])

  const option = useMemo(() => {
    if (!sankey) return null
    const colName = (c: number) => (c === maxStep + 1 ? finalTitle : `F${c}`)
    const isFinalCol = (c: number) => hasFinal && c === maxStep + 1
    const colorOf = (id: string) => {
      const [c, ...rest] = id.split('|')
      const v = rest.join('|')
      return pal.node(isFinalCol(Number(c)) ? `final:${v}` : v)
    }
    const base = baseOption(t) as any
    const maxCol = Math.max(...sankey.colTotal.values())
    const perCol = new Map<number, number>()
    sankey.nodes.forEach(([, n]) => perCol.set(n.col, (perCol.get(n.col) || 0) + 1))
    const maxNodes = Math.max(...perCol.values())
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: 'item',
        formatter: (p: any) => {
          if (p.dataType === 'edge') {
            const [fc, ...fv] = String(p.data.source).split('|')
            const [tc, ...tv] = String(p.data.target).split('|')
            const src = sankey.nodes.find(([id]) => id === p.data.source)?.[1]
            const srcOut = sankey.edges.filter((e) => e.source === p.data.source).reduce((a, e) => a + e.value, 0)
            return `${colName(Number(fc))} ${fv.join('|')} → ${colName(Number(tc))} ${tv.join('|')}<br/><b>${fmtInt(p.data.value)} ${unit}</b>`
              + (src ? `（${fv.join('|')} の ${fmtPct(p.data.value / srcOut)}）` : '')
          }
          const [c, ...rest] = String(p.data.name).split('|')
          const col = Number(c)
          const value = rest.join('|')
          const n = sankey.nodes.find(([id]) => id === p.data.name)?.[1]
          const total = n?.total ?? 0
          const s = stat.get(`${col}|${value}`)
          const lines = [`${colName(col)}　<b>${value}</b>`, `${fmtInt(total)} ${unit}（この列の ${fmtPct(total / (sankey.colTotal.get(col) || 1))}）`]
          if (s && !isFinalCol(col) && value !== EXIT) {
            if (s.weight > 0) lines.push(`1注文の平均 ${fmtYen(s.amount / s.weight)}`)
            if (multiDim && s.weight > 0) lines.push(`複数の${DIM_NOUN[dim] || '値'}を買った注文 ${fmtPct(s.multi / s.weight)}`)
          }
          if (s && isFinalCol(col) && s.weight > 0) lines.push(`累計購買金額の平均 ${fmtYen(s.amount / s.weight)}`)
          return lines.join('<br/>')
        },
      },
      series: [{
        type: 'sankey',
        left: 8,
        right: 120,
        top: 12,
        bottom: 12,
        nodeWidth: 12,
        nodeGap: 8,
        nodeAlign: 'justify',
        layoutIterations: 0,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        lineStyle: { curveness: 0.5, opacity: 0.32 },
        label: {
          position: 'right',
          color: t.ink,
          fontSize: 11,
          lineHeight: 14,
          textBorderColor: t.surface,
          textBorderWidth: 3,
        },
        data: sankey.nodes.map(([id, n]) => {
          const share = n.total / (sankey.colTotal.get(n.col) || 1)
          // approximate drawn height: the tallest column fills the plot area
          const px = (n.total / maxCol) * (CHART_H - 24 - 8 * maxNodes)
          const count = `${fmtInt(n.total)}${unit === '人' ? '人' : ''}${isFinalCol(n.col) ? `（${fmtPct(share)}）` : ''}`
          return {
            name: id,
            depth: n.col - 1,
            itemStyle: { color: colorOf(id), borderWidth: 0 },
            label: {
              show: px >= 11,
              formatter: () => (px >= 26 ? `{v|${n.value}}\n{c|${count}}` : `{v|${n.value}} {c|${count}}`),
              rich: { v: { fontSize: 11, fontWeight: 600, color: t.ink }, c: { fontSize: 10, color: t.muted } },
            },
          }
        }),
        links: sankey.edges.map((e) => ({ ...e, lineStyle: { color: colorOf(e.source) } })),
      }],
    }
  }, [sankey, pal, t, unit, stat, maxStep, finalTitle, hasFinal, multiDim, dim])

  // Headline numbers (independent of the population toggle)
  const head = useMemo(() => {
    const at = (step: number, reachedOnly = false) => nodes
      .filter((r) => num(r.step) === step && (!reachedOnly || num(r.reached) === 1))
      .reduce((a, r) => a + (num(r.weight) || 0), 0)
    const f1 = at(1), f2 = at(2), reached = at(1, true)
    const flow12 = links.filter((l) => str(l.kind) === 'flow' && num(l.step) === 1)
    const same = flow12.filter((l) => str(l.from_node) === str(l.to_node) && !isMulti(str(l.from_node)) && str(l.from_node) !== OTHER)
      .reduce((a, l) => a + (num(l.weight) || 0), 0)
    const flowTotal = flow12.reduce((a, l) => a + (num(l.weight) || 0), 0)
    const multiByStep = Array.from({ length: maxStep }, (_, i) => {
      const rows = b.freq_nodes.filter((r) => str(r.dimension) === dim && str(r.mode) === 'primary' && num(r.step) === i + 1)
      const w = rows.reduce((a, r) => a + (num(r.weight) || 0), 0)
      const m = rows.reduce((a, r) => a + (num(r.multi_weight) || 0), 0)
      return w > 0 ? m / w : NaN
    })
    return { f1, f2, reached, same: flowTotal > 0 ? same / flowTotal : NaN, multiByStep }
  }, [nodes, links, b, dim, maxStep])

  if (!b.freq_nodes.length) {
    return (
      <Section title="購入回数の推移">
        <Empty>
          フリークエンシー・サンキーのデータがありません。params.yml の frequency_sankey を設定して Workflow を実行し、ダッシュボードを作り直してください（POS の購買明細が必要です）。
        </Empty>
      </Section>
    )
  }

  const modeInfo = MODES.find((m) => m.id === mode)!
  const headerCols = sankey ? sankey.cols : maxStep + (hasFinal ? 1 : 0)
  const cohortNote = Number(cfg.new_customer_gap_days) > 0
    ? `POS の集計期間の最初の ${fmtInt(cfg.new_customer_gap_days)} 日に購入がなく、その後に初回購入した会員`
    : 'POS の集計期間で最初に購入した会員'
  return (
    <>
      <div className="filters">
        <Segmented label="軸" value={dim} onChange={setDim} options={dims.map((d) => ({ id: d, label: dimLabel(d, cfg) }))} />
        {multiDim && <Segmented label="1注文で複数を買ったとき" value={mode} onChange={setMode} options={MODES} />}
        <Segmented label="対象" value={pop} onChange={setPop} options={[
          { id: 'reached', label: `F${maxStep} まで購入した人`, help: `F${maxStep} まで購入した人の流れだけを表示します` },
          { id: 'all', label: '初回購入者全員（離脱も表示）', help: '途中で購入が止まった人を「(離脱)」として表示します' },
        ]} />
      </div>

      <div className="stats">
        <Stat label="初回購入者" value={`${fmtInt(head.f1)} 人`} sub={cohortNote} />
        <Stat label="2回目の購入" value={fmtPct(head.f2 / head.f1)} sub={`${fmtInt(head.f2)} 人`} />
        <Stat label={`F${maxStep} まで購入`} value={fmtPct(head.reached / head.f1)} sub={`${fmtInt(head.reached)} 人`} />
        <Stat label={`F1 → F2 で同じ${DIM_NOUN[dim] || '値'}を購入`} value={fmtPct(head.same)} sub="2回目を買った人のうち（その他・複数を除く）" />
        {multiDim && <Stat label={`F1 で複数の${DIM_NOUN[dim] || '値'}を購入`} value={fmtPct(head.multiByStep[0])} sub="初回の注文のうち" />}
      </div>

      <Section
        title={`F1 から F${maxStep} までの${dimLabel(dim, cfg)}の移り変わり${hasFinal ? `と、${finalTitle}` : ''}`}
        note={<>
          帯の太さは{unit === '人' ? '人数' : '人数（按分した人相当）'}。{multiDim && modeInfo.note}
          {hasFinal && ` 最終列は F${maxStep} 時点の${finalTitle}${cfg.final_column === 'amount_rank' && cfg.rank_thresholds ? `（区切り ${String(cfg.rank_thresholds).split(',').map((x) => fmtYen(x)).join(' / ')}）` : ''}。`}
          {Number(cfg.top_nodes) > 0 && ` 表示は購入者の多い上位 ${cfg.top_nodes} 件で、残りは「その他」。`}
        </>}>
        {option && sankey ? (
          <div className="sankey-scroll"><div className="sankey-wrap">
            <div className="sankey-head" aria-hidden="true">
              {Array.from({ length: headerCols }, (_, i) => (
                <span key={i} className={i + 1 === maxStep + 1 ? 'final' : ''}
                  style={{ left: headerCols > 1 ? `calc(8px + ${i} * (100% - 140px) / ${headerCols - 1})` : '8px' }}>
                  {i + 1 === maxStep + 1 ? finalTitle : `F${i + 1}`}
                  <small>{i + 1 === maxStep + 1 ? `F${maxStep} 時点` : i === 0 ? '初回購入' : `${i + 1}回目`}</small>
                </span>
              ))}
            </div>
            <EChart option={option} height={CHART_H} label={`購入回数ごとの${dimLabel(dim, cfg)}の移り変わり`} />
          </div></div>
        ) : <Empty>この条件のデータがありません。</Empty>}
      </Section>

      <div className="two">
        {hasFinal && <FinalPanel finals={finals} pal={pal} title={finalTitle} maxStep={maxStep} />}
        {hasFinal && <OutcomePanel rows={outcome} finals={finals} maxStep={maxStep} unit={unit} dimName={dimLabel(dim, cfg)} title={finalTitle} />}
      </div>

      {multiDim && <CombosPanel b={b} dim={dim} maxStep={maxStep} multiByStep={head.multiByStep} noun={DIM_NOUN[dim] || dimLabel(dim, cfg)} />}
    </>
  )
}

function FinalPanel({ finals, pal, title, maxStep }: { finals: { node: string; weight: number; amount: number }[]; pal: Pal; title: string; maxStep: number }) {
  const total = finals.reduce((a, f) => a + f.weight, 0)
  return (
    <Section title={`F${maxStep} 購入者の${title}`} note={`F${maxStep} まで購入した ${fmtInt(total)} 人の構成。`}>
      <div className="stack-bar" role="img" aria-label={`${title}の構成比`}>
        {finals.map((f) => <span key={f.node} style={{ flexGrow: f.weight, background: pal.node(`final:${f.node}`) }} title={`${f.node} ${fmtPct(f.weight / total)}`} />)}
      </div>
      <ul className="legend-list">
        {finals.map((f) => (
          <li key={f.node}>
            <span className="swatch" style={{ background: pal.node(`final:${f.node}`) }} />
            <span className="name">{f.node}</span>
            <span className="num">{fmtPct(f.weight / total)}</span>
            <span className="num muted">{fmtInt(f.weight)} 人</span>
            <span className="num muted">平均 {fmtYen(f.amount / f.weight)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function OutcomePanel({ rows, finals, maxStep, unit, dimName, title }: {
  rows: Row[]; finals: { node: string; order: number }[]; maxStep: number; unit: string; dimName: string; title: string
}) {
  const [step, setStep] = useState('1')
  const [target, setTarget] = useState(finals[0]?.node || '')
  const tgt = finals.some((f) => f.node === target) ? target : finals[0]?.node || ''
  const data = useMemo(() => {
    const m = new Map<string, { node: string; total: number; hit: number; customers: number }>()
    let all = 0, allHit = 0
    for (const r of rows) {
      if (num(r.step) !== Number(step)) continue
      const k = str(r.node)
      const w = num(r.weight) || 0
      const cur = m.get(k) || { node: k, total: 0, hit: 0, customers: 0 }
      cur.total += w
      cur.customers += num(r.customers) || 0
      all += w
      if (str(r.final_node) === tgt) { cur.hit += w; allHit += w }
      m.set(k, cur)
    }
    const list = [...m.values()].map((x) => ({ ...x, rate: x.total > 0 ? x.hit / x.total : NaN })).sort((a, b) => b.rate - a.rate)
    return { list, base: all > 0 ? allHit / all : NaN }
  }, [rows, step, tgt])
  return (
    <Section title={`F${step} の${dimName}別：${tgt}率`}
      note={`F${maxStep} まで購入した人のうち、F${step} でその値を買った人が「${tgt}」になった比率。点線は全体（${fmtPct(data.base)}）。30 ${unit}未満は参考値。`}>
      <div className="filters panel-filters">
        <Select label="何回目" value={step} onChange={setStep} options={Array.from({ length: maxStep }, (_, i) => ({ id: String(i + 1), label: `F${i + 1}` }))} />
        <Select label={title} value={tgt} onChange={setTarget} options={finals.map((f) => ({ id: f.node, label: f.node }))} />
      </div>
      {data.list.length ? (
        <ul className="rate-list">
          {data.list.map((x) => (
            <li key={x.node} className={x.total < 30 ? 'thin' : ''}>
              <span className="name">{x.node}</span>
              <span className="track">
                <span className={`fill ${x.rate >= data.base ? 'hi' : 'lo'}`} style={{ width: `${Math.max(0, Math.min(1, x.rate)) * 100}%` }} />
                {!Number.isNaN(data.base) && <span className="base" style={{ left: `${data.base * 100}%` }} />}
              </span>
              <span className="num">{fmtPct(x.rate)}</span>
              <span className="num muted">{fmtInt(x.total)} {unit}</span>
            </li>
          ))}
        </ul>
      ) : <Empty>データがありません。</Empty>}
    </Section>
  )
}

function CombosPanel({ b, dim, maxStep, multiByStep, noun }: { b: Bundle; dim: string; maxStep: number; multiByStep: number[]; noun: string }) {
  const [step, setStep] = useState('1')
  const rows = useMemo(() => b.freq_combos
    .filter((r) => str(r.dimension) === dim && num(r.step) === Number(step))
    .map((r) => ({ ...r, share: num(r.orders) / num(r.orders_all) })), [b, dim, step])
  return (
    <Section title={`1注文で複数の${noun}を買ったときの組み合わせ`}
      note={`サンキー図で「複数」にまとめたり按分したりしている注文の中身です。組み合わせは図と同じ値（上位と「その他」）で数えています。`}
      actions={<Select label="何回目" value={step} onChange={setStep} options={Array.from({ length: maxStep }, (_, i) => ({ id: String(i + 1), label: `F${i + 1}` }))} />}>
      <div className="chips-row">
        {multiByStep.map((v, i) => (
          <span key={i} className={`chip${String(i + 1) === step ? ' on' : ''}`}>F{i + 1} {fmtPct(v)}</span>
        ))}
        <span className="muted small">… 複数の{noun}を含む注文の比率</span>
      </div>
      <DataTable rows={rows} caption="複数購入の組み合わせ" initialSort="orders" limit={10} cols={[
        { key: 'combo', label: '組み合わせ' },
        { key: 'orders', label: '注文', num: true, fmt: fmtInt },
        { key: 'share', label: `F${step} の注文に占める比率`, num: true, fmt: (v) => fmtPct(v) },
        { key: 'orders_reached', label: `うち F${maxStep} まで購入した人`, num: true, fmt: fmtInt },
      ]} />
    </Section>
  )
}
