import { useMemo, useState } from 'react'
import { EChart, baseOption, categoryAxis, legend, useTheme, valueAxis } from './charts'
import {
  COMPONENTS, MODELS, PAGE_LABELS, PATTERN_TYPES, behaviorText, fmtCompact, fmtDate, fmtDec, fmtInt, fmtLift, fmtPct, fmtYen,
  num, pathText, str, sumBy, type Bundle, type Row,
} from './data'
import { ComponentBars, DataTable, Empty, Route, Section, Segmented, Select, Stat, type Col } from './ui'

const pct = (a: unknown, b: unknown) => {
  const x = num(a), y = num(b)
  return y > 0 ? x / y : NaN
}

// ---------------------------------------------------------------------------
export function Overview({ b, go }: { b: Bundle; go: (tab: string) => void }) {
  const k = b.kpi
  const loyalShare = pct(k.loyal_revenue, k.rfm_revenue)
  const top = useMemo(() => {
    const pick = (type: string) => b.golden_paths.filter((r) => r.pattern_type === type).sort((x, y) => num(x.golden_rank) - num(y.golden_rank))
    const full = pick('full')
    return (full.length ? full : pick('acquisition_product')).slice(0, 3)
  }, [b])
  return (
    <>
      <div className="stats">
        <Stat label="セッション" value={fmtInt(k.sessions)} sub={`${fmtInt(k.persons)} 人`} />
        <Stat label="EC 購入（Web）" value={fmtInt(k.conversions)} sub={`CVR ${fmtPct(k.session_cvr, 2)}`} />
        <Stat label="EC 売上（Web）" value={fmtYen(k.revenue)} sub={`客単価 ${fmtYen(k.aov)}`} />
        <Stat label="新規顧客の購入" value={fmtPct(pct(k.new_customer_cv, k.conversions))} sub={`${fmtInt(k.new_customer_cv)} 件`} />
        <Stat label="ロイヤル顧客" value={`${fmtInt(k.loyal_customers)} 人`} sub={Number.isNaN(loyalShare) ? 'RFM なし' : `購買金額の ${fmtPct(loyalShare)}`} />
      </div>

      <Section title="いま有力なゴールデンパス" note="流入経路・サイト内行動・購入商品の組み合わせを、CVR・ロイヤル率・再購入率・客単価・件数でスコア化した上位です。"
        actions={<button type="button" className="link" onClick={() => go('golden')}>すべてのパターンを見る</button>}>
        {top.length ? (
          <div className="golden-list">
            {top.map((r, i) => <GoldenCard key={i} r={r} />)}
          </div>
        ) : <Empty>最小 CV 数を満たすパターンがまだありません。集計期間を延ばすか、golden_path.min_support を下げてください。</Empty>}
      </Section>

      <Funnel b={b} />
    </>
  )
}

function Funnel({ b }: { b: Bundle }) {
  const t = useTheme()
  const all = b.funnel.find((r) => r.first_channel === '(全体)')
  const stages: [string, string][] = [
    ['persons', '流入'], ['browsed', '回遊'], ['members', '会員'], ['purchased', '購買'], ['revisited', '再訪問'], ['repurchased', '再購入'],
  ]
  const option = useMemo(() => {
    if (!all) return null
    const vals = stages.map(([k]) => num(all[k]))
    const base = vals[0]
    return {
      ...baseOption(t),
      grid: { left: 64, right: 120, top: 8, bottom: 8, containLabel: false },
      tooltip: { ...(baseOption(t) as any).tooltip, trigger: 'item', formatter: (p: any) => `${p.name}<br/><b>${fmtInt(p.value)} 人</b>（流入の ${fmtPct(p.value / base)}）` },
      xAxis: { ...valueAxis(t), show: false },
      yAxis: categoryAxis(t, stages.map(([, l]) => l), { inverse: true, axisLine: { show: false }, axisLabel: { color: t.ink, fontSize: 12 } }),
      series: [{
        type: 'bar', data: vals, barWidth: 20, itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.ink2, fontSize: 12, formatter: (p: any) => `${fmtInt(p.value)}  ${fmtPct(p.value / base)}` },
      }],
    }
  }, [all, t])
  const rows = b.funnel.filter((r) => r.first_channel !== '(全体)')
  const cols: Col[] = [
    { key: 'first_channel', label: '最初の流入' },
    { key: 'persons', label: '流入', num: true, fmt: fmtInt },
    { key: 'browsed', label: '回遊率', num: true, fmt: (_v, r) => fmtPct(pct(r.browsed, r.persons)) },
    { key: 'members', label: '会員率', num: true, fmt: (_v, r) => fmtPct(pct(r.members, r.persons)) },
    { key: 'purchased', label: '購買率', num: true, fmt: (_v, r) => fmtPct(pct(r.purchased, r.persons)) },
    { key: 'revisited', label: '購買後の再訪問', num: true, fmt: (_v, r) => fmtPct(pct(r.revisited, r.purchased)) },
    { key: 'repurchased', label: '再購入', num: true, fmt: (_v, r) => fmtPct(pct(r.repurchased, r.purchased)) },
    { key: 'median_days_to_purchase', label: '購買までの日数（中央値）', num: true, fmt: (v) => fmtDec(v) },
  ]
  return (
    <Section title="購買サイクル" note="集計期間に訪問した人のうち、各段階に進んだ人数。会員は会員IDで識別できた人、購買は Web の購入と会員の店舗・EC 購入を含みます。">
      {option ? <EChart option={option} height={230} label="購買サイクルのファネル" /> : <Empty>ファネルのデータがありません。</Empty>}
      <h3 className="sub">最初の流入チャネル別</h3>
      <DataTable rows={rows} cols={cols} initialSort="persons" caption="最初の流入チャネル別の購買サイクル" />
    </Section>
  )
}

// ---------------------------------------------------------------------------
function GoldenCard({ r, rank }: { r: Row; rank?: number }) {
  const strengths = str(r.strengths).split(',').filter(Boolean)
  const label = (id: string) => COMPONENTS.find((c) => c.id === id)?.label || id
  return (
    <article className="golden-card">
      <div className="golden-head">
        <span className="golden-rank">{rank ?? fmtInt(r.golden_rank)}</span>
        <div className="golden-score">
          <span className="score-num">{fmtDec(r.score)}</span>
          <span className="score-unit">点</span>
        </div>
        <div className="golden-strengths">
          {strengths.map((s) => <span className="chip" key={s}>{label(s)}が強い</span>)}
        </div>
      </div>
      <Route path={r.path_pattern} behavior={r.behavior_signature} product={r.product_group} />
      <div className="golden-body">
        <dl className="golden-metrics">
          <div><dt>CV</dt><dd>{fmtInt(r.conversions)} 件</dd></div>
          <div><dt>売上</dt><dd>{fmtYen(r.revenue)}</dd></div>
          <div><dt>客単価</dt><dd>{fmtYen(r.revenue_per_cv)}</dd></div>
          <div><dt>ロイヤル率</dt><dd>{fmtPct(r.loyal_rate)}</dd></div>
          <div><dt>再購入率</dt><dd>{fmtPct(r.repeat_rate)}</dd></div>
        </dl>
        <ComponentBars row={r} items={COMPONENTS} />
      </div>
    </article>
  )
}

export function Golden({ b }: { b: Bundle }) {
  const available = PATTERN_TYPES.filter((p) => b.golden_paths.some((r) => r.pattern_type === p.id) || b.golden_candidates.some((r) => r.pattern_type === p.id))
  const [type, setType] = useState(available[0]?.id || 'full')
  const picked = b.golden_paths.filter((r) => r.pattern_type === type).sort((x, y) => num(x.golden_rank) - num(y.golden_rank))
  const cands = b.golden_candidates.filter((r) => r.pattern_type === type)
  const w = b.meta.config?.golden_path
  const cols: Col[] = [
    { key: 'score', label: 'スコア', num: true, fmt: (v) => fmtDec(v) },
    ...(type.startsWith('acq') || type === 'full' ? [{ key: 'path_pattern', label: '流入経路', fmt: (v: unknown) => pathText(v) }] : []),
    ...(type.startsWith('onsite') || type === 'full' ? [{ key: 'behavior_signature', label: 'サイト内行動', fmt: (v: unknown) => behaviorText(v) }] : []),
    ...(type.endsWith('product') || type === 'full' ? [{ key: 'product_group', label: '商品' }] : []),
    { key: 'conversions', label: 'CV', num: true, fmt: fmtInt },
    { key: 'revenue', label: '売上', num: true, fmt: fmtYen },
    { key: 'cvr_lift', label: 'CVR 比', num: true, fmt: fmtLift },
    { key: 'loyalty_lift', label: 'ロイヤル率 比', num: true, fmt: fmtLift },
    { key: 'repeat_lift', label: '再購入率 比', num: true, fmt: fmtLift },
    { key: 'value_index', label: '客単価 比', num: true, fmt: fmtLift },
  ]
  return (
    <>
      <div className="filters">
        <Segmented label="パターンの単位" value={type} options={available.length ? available : PATTERN_TYPES} onChange={setType} />
      </div>
      <Section title={`採用パターン：${PATTERN_TYPES.find((p) => p.id === type)?.label}`}
        note={<>
          スコアは 50 が全体平均並み。各要素の「比」は全体平均との比で、件数の少ないパターンは平均に寄せて計算しています（事前サンプル {w?.prior_strength ?? '—'}）。
          同じ入口からの採用は {w?.max_per_entry ?? '—'} 件まで、CV {w?.min_support ?? '—'} 件以上が対象です。
        </>}>
        {picked.length ? <div className="golden-list">{picked.map((r, i) => <GoldenCard key={i} r={r} />)}</div>
          : <Empty>この単位で採用されたパターンはありません。</Empty>}
      </Section>
      <Section title="候補一覧" note="最小 CV 数を満たす候補（スコア上位 100 件）。列見出しで並べ替えできます。">
        <DataTable rows={cands} cols={cols} initialSort="score" limit={30} caption="ゴールデンパス候補" />
      </Section>
      {w && (
        <Section title="スコアの重み">
          <div className="weights">
            {COMPONENTS.map((c) => (
              <div key={c.id} className="weight"><span>{c.label}</span><b>{fmtDec(w.weights?.[c.id], 2)}</b><small>{c.help}</small></div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
export function Attribution({ b }: { b: Bundle }) {
  const t = useTheme()
  const [metric, setMetric] = useState<'conv' | 'rev'>('conv')
  const [model, setModel] = useState('linear')
  const channels = useMemo(() => [...b.attribution_channel].sort((x, y) => num(y.conv_linear) - num(x.conv_linear)), [b])
  const option = useMemo(() => {
    const names = channels.map((r) => str(r.channel))
    return {
      ...baseOption(t),
      legend: { ...legend(t), data: MODELS.map((m) => m.label) },
      grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
      tooltip: { ...(baseOption(t) as any).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.4 } },
        valueFormatter: (v: number) => (metric === 'rev' ? fmtYen(v) : `${fmtDec(v)} 件`) },
      xAxis: valueAxis(t, (v: number) => fmtCompact(v)),
      yAxis: categoryAxis(t, names, { inverse: true }),
      series: MODELS.map((m, i) => ({
        name: m.label, type: 'bar', barWidth: 6, barGap: '30%',
        itemStyle: { color: t.series[i], borderRadius: [0, 3, 3, 0] },
        data: channels.map((r) => num(r[`${metric}_${m.id}`]) || 0),
      })),
    }
  }, [channels, metric, t])
  const touchCols: Col[] = [
    { key: 'touch_key', label: 'タッチ' },
    { key: 'channel', label: 'チャネル' },
    { key: `conv_${model}`, label: 'CV（貢献）', num: true, fmt: (v) => fmtDec(v) },
    { key: `rev_${model}`, label: '売上（貢献）', num: true, fmt: fmtYen },
    { key: 'cv_paths', label: '関与した CV', num: true, fmt: fmtInt },
    { key: 'assisted_cv', label: 'アシスト', num: true, fmt: fmtInt },
    { key: 'touches', label: 'タッチ数', num: true, fmt: fmtInt },
    { key: 'avg_days_before_cv', label: 'CV までの日数', num: true, fmt: (v) => fmtDec(v) },
  ]
  const genRows = b.path_length.filter((r) => r.metric === 'generations')
  const dayRows = b.path_length.filter((r) => r.metric === 'days_to_cv')
  const cfg = b.meta.config?.attribution
  return (
    <>
      <div className="filters">
        <Segmented label="指標" value={metric} onChange={setMetric} options={[{ id: 'conv', label: 'CV 数' }, { id: 'rev', label: '売上' }]} />
      </div>
      <Section title="チャネル別：モデルによる評価の違い"
        note={cfg ? `CV 前 ${cfg.lookback_days} 日・最大 ${cfg.max_generations} 世代を遡り、同じタッチが内部遷移を挟んで続いた場合は 1 世代に集約しています（粒度: ${cfg.grain}）。逓減の半減期 ${cfg.decay_half_life_days} 日、U字は最初 ${cfg.u_first}／最後 ${cfg.u_last}。` : undefined}>
        {channels.length ? <EChart option={option} height={Math.max(260, channels.length * 46 + 60)} label="チャネル別のモデル比較" /> : <Empty>データがありません。</Empty>}
        <DataTable rows={channels} caption="チャネル別アトリビューション" initialSort={`${metric}_linear`} cols={[
          { key: 'channel', label: 'チャネル' },
          ...MODELS.map((m) => ({ key: `${metric}_${m.id}`, label: m.label, num: true, fmt: (v: unknown) => (metric === 'rev' ? fmtYen(v) : fmtDec(v)) })),
          { key: 'assisted_cv', label: 'アシスト', num: true, fmt: fmtInt },
        ]} />
      </Section>
      <Section title="タッチ別の貢献" actions={<Segmented label="モデル" value={model} onChange={setModel} options={MODELS} />}>
        <DataTable rows={b.attribution_touch} cols={touchCols} initialSort={`conv_${model}`} caption="タッチ別アトリビューション" />
      </Section>
      <div className="two">
        <Section title="経路の長さ（世代数）">
          <Columns rows={genRows} label="世代数別の CV" unit="世代" />
        </Section>
        <Section title="最初のタッチから購入までの日数">
          <Columns rows={dayRows} label="購入までの日数別の CV" />
        </Section>
      </div>
      <Section title="よく出現する経路">
        <DataTable rows={b.top_paths} caption="よく出現する経路" initialSort="conversions" limit={20} cols={[
          { key: 'channel_path', label: '経路', fmt: (v) => pathText(v) },
          { key: 'conversions', label: 'CV', num: true, fmt: fmtInt },
          { key: 'revenue', label: '売上', num: true, fmt: fmtYen },
          { key: 'avg_days_to_cv', label: '日数', num: true, fmt: (v) => fmtDec(v) },
          { key: 'new_customer_cv', label: '新規', num: true, fmt: (_v, r) => fmtPct(pct(r.new_customer_cv, r.conversions)) },
          { key: 'loyal_cv', label: 'ロイヤル', num: true, fmt: (_v, r) => fmtPct(pct(r.loyal_cv, r.conversions)) },
        ]} />
      </Section>
    </>
  )
}

function Columns({ rows, label, unit }: { rows: Row[]; label: string; unit?: string }) {
  const t = useTheme()
  const sorted = [...rows].sort((a, b) => num(a.bucket_order) - num(b.bucket_order))
  const option = useMemo(() => ({
    ...baseOption(t),
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...(baseOption(t) as any).tooltip, trigger: 'item', formatter: (p: any) => `${p.name}${unit || ''}<br/><b>${fmtInt(p.value)} 件</b>` },
    xAxis: categoryAxis(t, sorted.map((r) => str(r.bucket))),
    yAxis: valueAxis(t, (v: number) => fmtCompact(v)),
    series: [{ type: 'bar', barMaxWidth: 24, data: sorted.map((r) => num(r.conversions)), itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] } }],
  }), [sorted, t, unit])
  if (!rows.length) return <Empty>データがありません。</Empty>
  return <EChart option={option} height={220} label={label} />
}

// ---------------------------------------------------------------------------
export function Rfm({ b }: { b: Bundle }) {
  const t = useTheme()
  const [m, setM] = useState('all')
  const [metric, setMetric] = useState<'customers' | 'revenue'>('customers')
  const grid = useMemo(() => {
    const cells: Record<string, number> = {}
    for (const r of b.rfm_matrix) {
      if (m !== 'all' && String(r.m) !== m) continue
      const key = `${r.r}-${r.f}`
      cells[key] = (cells[key] || 0) + (num(r[metric]) || 0)
    }
    return cells
  }, [b, m, metric])
  const option = useMemo(() => {
    const max = Math.max(0, ...Object.values(grid))
    // labels on the darker half of the violet ramp switch to white so they stay readable
    const strong = '#ffffff'
    const data: { value: [number, number, number]; label: { color: string } }[] = []
    for (let r = 1; r <= 5; r++) for (let f = 1; f <= 5; f++) {
      const v = grid[`${r}-${f}`] || 0
      data.push({ value: [r - 1, f - 1, v], label: { color: max && v / max > 0.5 ? strong : t.ink } })
    }
    return {
      ...baseOption(t),
      grid: { left: 8, right: 8, top: 8, bottom: 64, containLabel: true },
      tooltip: { ...(baseOption(t) as any).tooltip, trigger: 'item',
        formatter: (p: any) => `R${p.value[0] + 1} × F${p.value[1] + 1}${m === 'all' ? '' : ` × M${m}`}<br/><b>${metric === 'revenue' ? fmtYen(p.value[2]) : `${fmtInt(p.value[2])} 人`}</b>` },
      xAxis: categoryAxis(t, ['R1', 'R2', 'R3', 'R4', 'R5'], { name: '最近購入した →', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: t.muted, fontSize: 11 }, axisLine: { show: false } }),
      yAxis: categoryAxis(t, ['F1', 'F2', 'F3', 'F4', 'F5'], { name: '購入回数が多い →', nameLocation: 'middle', nameGap: 34, nameRotate: 90, nameTextStyle: { color: t.muted, fontSize: 11 }, axisLine: { show: false } }),
      visualMap: { min: 0, max: max || 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10,
        inRange: { color: t.seq }, text: ['多い', '少ない'], textGap: 8, textStyle: { color: t.muted, fontSize: 11 }, formatter: (v: number) => (metric === 'revenue' ? fmtYen(v) : fmtInt(v)) },
      series: [{
        type: 'heatmap', data,
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
        label: { show: true, fontSize: 11, formatter: (p: any) => (p.value[2] ? (metric === 'revenue' ? fmtCompact(p.value[2]) : fmtInt(p.value[2])) : '') },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
      }],
    }
  }, [grid, t, m, metric])
  const segs = useMemo(() => {
    const acc: Record<string, Row> = {}
    for (const r of b.rfm_segments) {
      const k = str(r.segment)
      const a = (acc[k] ||= { segment: k, customers: 0, revenue: 0, ec_revenue: 0, orders: 0 })
      for (const c of ['customers', 'revenue', 'ec_revenue', 'orders']) a[c] = num(a[c]) + (num(r[c]) || 0)
    }
    return Object.values(acc)
  }, [b])
  const totalCust = sumBy(segs, 'customers')
  const ages = useMemo(() => [...new Set(b.rfm_segments.map((r) => str(r.age_band)))].sort(), [b])
  const [seg, setSeg] = useState('チャンピオン')
  const demo = useMemo(() => {
    const rows = b.rfm_segments.filter((r) => r.segment === seg)
    const byGender: Record<string, Row> = {}
    for (const r of rows) {
      const g = str(r.gender)
      const a = (byGender[g] ||= { gender: g, total: 0 })
      a[str(r.age_band)] = (num(a[str(r.age_band)]) || 0) + (num(r.customers) || 0)
      a.total = num(a.total) + (num(r.customers) || 0)
    }
    return Object.values(byGender)
  }, [b, seg])
  const cfg = b.meta.config?.rfm
  return (
    <>
      <div className="filters">
        <Select label="M（購入金額）" value={m} onChange={setM} options={[{ id: 'all', label: 'すべて' }, ...[5, 4, 3, 2, 1].map((x) => ({ id: String(x), label: `M${x}` }))]} />
        <Segmented label="指標" value={metric} onChange={setMetric} options={[{ id: 'customers', label: '人数' }, { id: 'revenue', label: '購入金額' }]} />
      </div>
      <Section title="RFM マトリクス（R × F）"
        note={<>POS の購買（{cfg?.scope === 'ec' ? 'EC のみ' : '店舗＋EC'}）から R・F・M を各 5 段階で判定した 125 ブロックを、M で絞り込んで R × F で表示しています。ロイヤル顧客の定義：<code>{cfg?.loyal_condition ?? '—'}</code></>}>
        {b.rfm_matrix.length ? <EChart option={option} height={380} label="RFM マトリクス" /> : <Empty>RFM のデータがありません（POS データが未設定の可能性があります）。</Empty>}
      </Section>
      <Section title="セグメント">
        <DataTable rows={segs} caption="RFM セグメント" initialSort="customers" onRowClick={(r) => setSeg(str(r.segment))} rowKey="segment" selectedKey={seg} cols={[
          { key: 'segment', label: 'セグメント' },
          { key: 'customers', label: '人数', num: true, fmt: fmtInt },
          { key: 'share', label: '構成比', num: true, fmt: (_v, r) => fmtPct(pct(r.customers, totalCust)) },
          { key: 'revenue', label: '購入金額', num: true, fmt: fmtYen },
          { key: 'ec_revenue', label: 'うち EC', num: true, fmt: (_v, r) => fmtPct(pct(r.ec_revenue, r.revenue)) },
          { key: 'orders', label: '1人あたり購入回数', num: true, fmt: (_v, r) => fmtDec(pct(r.orders, r.customers)) },
        ]} />
        <h3 className="sub">「{seg}」の性別 × 年代（行を選ぶと切り替わります）</h3>
        <DataTable rows={demo} caption="性別と年代" initialSort="total" cols={[
          { key: 'gender', label: '性別' },
          ...ages.map((a) => ({ key: a, label: a, num: true, fmt: fmtInt })),
          { key: 'total', label: '計', num: true, fmt: fmtInt },
        ]} />
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------
const DIMENSIONS = [
  { id: 'path', label: '流入経路' },
  { id: 'behavior', label: 'サイト内行動' },
  { id: 'first_channel', label: '最初のチャネル' },
  { id: 'landing', label: '着地ページ' },
]

function patternLabel(dim: string, v: unknown) {
  if (dim === 'behavior') return behaviorText(v)
  if (dim === 'landing') return PAGE_LABELS[str(v)] || str(v)
  if (dim === 'path') return pathText(v)
  return str(v)
}

export function Loyal({ b }: { b: Bundle }) {
  const t = useTheme()
  const groups = useMemo(() => {
    const s = new Set(b.loyal_product_paths.map((r) => str(r.product_group)))
    return ['(全商品)', ...[...s].filter((x) => x !== '(全商品)')]
  }, [b])
  const [group, setGroup] = useState('(全商品)')
  const [dim, setDim] = useState('path')
  const rows = b.loyal_product_paths.filter((r) => r.product_group === group && r.dimension === dim)
  const top = [...rows].sort((x, y) => num(y.loyal_cv) - num(x.loyal_cv)).slice(0, 10)
  const option = useMemo(() => ({
    ...baseOption(t),
    legend: { ...legend(t), data: ['ロイヤル顧客', 'それ以外'] },
    grid: { left: 8, right: 48, top: 36, bottom: 8, containLabel: true },
    tooltip: { ...(baseOption(t) as any).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.4 } }, valueFormatter: (v: number) => fmtPct(v) },
    xAxis: valueAxis(t, (v: number) => `${Math.round(v * 100)}%`),
    yAxis: categoryAxis(t, top.map((r) => patternLabel(dim, r.pattern)), { inverse: true, axisLabel: { color: t.ink2, fontSize: 11, width: 220, overflow: 'truncate' } }),
    series: [
      { name: 'ロイヤル顧客', type: 'bar', barWidth: 8, barGap: '25%', itemStyle: { color: t.series[0], borderRadius: [0, 3, 3, 0] }, data: top.map((r) => num(r.loyal_share) || 0) },
      { name: 'それ以外', type: 'bar', barWidth: 8, itemStyle: { color: t.axis, borderRadius: [0, 3, 3, 0] }, data: top.map((r) => num(r.other_share) || 0) },
    ],
  }), [top, t, dim])
  const stats = b.loyal_behavior_stats.filter((r) => r.product_group === group)
  const loyal = stats.find((r) => r.customer_type === 'loyal')
  const other = stats.find((r) => r.customer_type === 'other')
  const metrics: [string, string, (v: unknown) => string][] = [
    ['conversions', 'CV', fmtInt], ['avg_revenue', '客単価', fmtYen], ['avg_generations', '経路の世代数', (v) => fmtDec(v)],
    ['avg_days_to_cv', '購入までの日数', (v) => fmtDec(v)], ['avg_sessions_to_cv', '購入までのセッション数', (v) => fmtDec(v)],
    ['avg_pdp_views', '購入までの商品詳細の閲覧数', (v) => fmtDec(v)], ['search_rate', '検索を使った割合', (v) => fmtPct(v)],
    ['content_rate', '特集・記事を見た割合', (v) => fmtPct(v)], ['email_touch_rate', '経路にメールを含む割合', (v) => fmtPct(v)],
    ['paid_touch_rate', '経路に広告を含む割合', (v) => fmtPct(v)], ['mobile_rate', 'スマホの割合', (v) => fmtPct(v)],
    ['repurchase_rate', '再購入率', (v) => fmtPct(v)],
  ]
  if (!b.loyal_product_paths.length) return <Empty>ロイヤル顧客の分析には会員IDと POS データ（RFM）が必要です。</Empty>
  return (
    <>
      <div className="filters">
        <Select label="商品グループ" value={group} onChange={setGroup} options={groups.map((g) => ({ id: g, label: g }))} />
        <Segmented label="観点" value={dim} onChange={setDim} options={DIMENSIONS} />
      </div>
      <Section title={`ロイヤル顧客は「${group}」をどう買っているか`}
        note="その商品グループを購入した CV のうち、各パターンが占める割合を、ロイヤル顧客とそれ以外で比べています。特徴度はロイヤル顧客での出やすさ（1 より大きいほどロイヤル顧客に特徴的）。">
        {top.length ? <EChart option={option} height={Math.max(240, top.length * 34 + 60)} label="ロイヤル顧客とそれ以外のパターン比較" /> : <Empty>データがありません。</Empty>}
        <DataTable rows={rows} caption="パターン別の比較" initialSort="loyal_cv" cols={[
          { key: 'pattern', label: DIMENSIONS.find((d) => d.id === dim)?.label || '', fmt: (v) => patternLabel(dim, v) },
          { key: 'loyal_cv', label: 'ロイヤル CV', num: true, fmt: fmtInt },
          { key: 'loyal_share', label: 'ロイヤル内の割合', num: true, fmt: (v) => fmtPct(v) },
          { key: 'other_share', label: 'それ以外の割合', num: true, fmt: (v) => fmtPct(v) },
          { key: 'loyal_index', label: '特徴度', num: true, fmt: fmtLift },
        ]} />
      </Section>
      <Section title="行動の比較">
        <div className="table-wrap">
          <table>
            <caption className="sr-only">ロイヤル顧客とそれ以外の行動指標</caption>
            <thead><tr><th>指標</th><th className="num">ロイヤル顧客</th><th className="num">それ以外</th></tr></thead>
            <tbody>
              {metrics.map(([k, l, f]) => (
                <tr key={k}><td>{l}</td><td className="num">{loyal ? f(loyal[k]) : '—'}</td><td className="num">{other ? f(other[k]) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------
export function Ads({ b }: { b: Bundle }) {
  const t = useTheme()
  const [model, setModel] = useState('linear')
  const ads = useMemo(() => [...b.ad_contribution].sort((x, y) => num(y[`conv_${model}`]) - num(x[`conv_${model}`])), [b, model])
  const [sel, setSel] = useState<string>('')
  const current = ads.find((r) => r.touch_key === sel) || ads[0]
  const roleTop = ads.slice(0, 12)
  const roles: [string, string][] = [['role_first', '最初'], ['role_middle', '中間'], ['role_last', '最後'], ['role_only', '単独']]
  const roleOption = useMemo(() => ({
    ...baseOption(t),
    legend: { ...legend(t), data: roles.map(([, l]) => l) },
    grid: { left: 24, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: { ...(baseOption(t) as any).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.4 } }, valueFormatter: (v: number) => fmtPct(v) },
    xAxis: { ...valueAxis(t, (v: number) => `${Math.round(v * 100)}%`), max: 1 },
    yAxis: categoryAxis(t, roleTop.map((r) => str(r.touch_key)), { inverse: true, axisLabel: { color: t.ink2, fontSize: 11, width: 220, overflow: 'truncate' } }),
    series: roles.map(([k, l], i) => ({
      name: l, type: 'bar', stack: 'role', barWidth: 16,
      itemStyle: { color: t.series[i], borderColor: t.surface, borderWidth: 1 },
      data: roleTop.map((r) => {
        const tot = roles.reduce((a, [kk]) => a + (num(r[kk]) || 0), 0)
        return tot ? (num(r[k]) || 0) / tot : 0
      }),
    })),
  }), [roleTop, t])
  const products = b.ad_product.filter((r) => current && r.touch_key === current.touch_key)
  const prodOption = useMemo(() => ({
    ...baseOption(t),
    grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...(baseOption(t) as any).tooltip, trigger: 'item', formatter: (p: any) => `${p.name}<br/><b>${fmtYen(p.value)}</b>（線形モデル）` },
    xAxis: { ...valueAxis(t), show: false },
    yAxis: categoryAxis(t, products.slice(0, 10).map((r) => str(r.product_group)), { inverse: true, axisLine: { show: false } }),
    series: [{ type: 'bar', barWidth: 14, itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] }, data: products.slice(0, 10).map((r) => num(r.rev_linear) || 0),
      label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: any) => fmtYen(p.value) } }],
  }), [products, t])
  if (!ads.length) return <Empty>広告として判定されたタッチがありません。params.yml の ads.paid_medium_regex / paid_channel_regex を確認してください。</Empty>
  return (
    <>
      <div className="filters">
        <Segmented label="モデル" value={model} onChange={setModel} options={MODELS} />
      </div>
      <Section title="広告の購買貢献" note="行を選ぶと、その広告の詳細が下に表示されます。アシストは、購入直前以外の位置で経路に含まれた CV の数です。">
        <DataTable rows={ads} caption="広告の購買貢献" initialSort={`conv_${model}`} rowKey="touch_key" selectedKey={str(current?.touch_key)} onRowClick={(r) => setSel(str(r.touch_key))} cols={[
          { key: 'touch_key', label: '広告' },
          { key: 'channel', label: 'チャネル' },
          { key: `conv_${model}`, label: 'CV（貢献）', num: true, fmt: (v) => fmtDec(v) },
          { key: `rev_${model}`, label: '売上（貢献）', num: true, fmt: fmtYen },
          { key: 'conv_last', label: 'ラストクリック CV', num: true, fmt: (v) => fmtDec(v) },
          { key: 'assisted_cv', label: 'アシスト', num: true, fmt: fmtInt },
          { key: 'reach_persons', label: 'リーチ人数', num: true, fmt: fmtInt },
          { key: 'new_customer_rate', label: '新規率', num: true, fmt: (v) => fmtPct(v) },
          { key: 'loyal_rate', label: 'ロイヤル率', num: true, fmt: (v) => fmtPct(v) },
        ]} />
      </Section>
      {current && (
        <Section title={str(current.touch_key)} note="この広告が関わった購入の特徴と、貢献した商品グループ。">
          <div className="stats">
            <Stat label="関与した CV" value={fmtInt(current.cv_paths)} sub={`アシスト ${fmtInt(current.assisted_cv)}`} />
            <Stat label="客単価" value={fmtYen(current.avg_order_value)} />
            <Stat label="新規顧客の割合" value={fmtPct(current.new_customer_rate)} />
            <Stat label="再購入率" value={fmtPct(current.repurchase_rate)} />
            <Stat label="タッチから購入まで" value={`${fmtDec(current.avg_days_before_cv)} 日`} />
          </div>
          {products.length ? <EChart option={prodOption} height={Math.max(160, Math.min(10, products.length) * 30 + 20)} label="商品グループ別の貢献売上" /> : <Empty>購入商品のデータがありません。</Empty>}
        </Section>
      )}
      <Section title="経路の中での役割" note="経路の最初・中間・最後・単独（その広告だけの経路）のどこで登場したかの比率。最初が多い広告は認知・獲得、最後が多い広告は刈り取りの役割です。">
        <EChart option={roleOption} height={Math.max(220, roleTop.length * 30 + 60)} label="広告の役割の比率" />
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------
export function Email({ b }: { b: Bundle }) {
  const emails = useMemo(() => [...b.email_influence].sort((x, y) => num(y.sessions) - num(x.sessions)), [b])
  const [sel, setSel] = useState('')
  const cur = emails.find((r) => r.email_key === sel) || emails[0]
  const products = b.email_product.filter((r) => cur && r.email_key === cur.email_key)
  const days = b.meta.config?.email?.same_product_window_days
  if (!emails.length) return <Empty>メール経由のセッションがありません。params.yml の email.medium_regex / source_regex を確認してください。</Empty>
  const steps: [string, string, unknown][] = cur ? [
    ['セッション', 'メールから訪問', cur.sessions],
    ['商品詳細を閲覧', 'セッション', cur.sessions_with_pdp],
    ['閲覧した人', '人', cur.viewers],
    ['同じ商品を購入', '人', cur.same_product_buyers],
  ] : []
  return (
    <>
      <Section title="メール → 商品閲覧 → 同じ商品の購入" note={`メール経由のセッションで閲覧した商品を、${days ?? '—'} 日以内に同じ人が購入したか（Web・店舗の両方）を見ています。行を選ぶと詳細が表示されます。`}>
        <DataTable rows={emails} caption="メール別の効果" initialSort="sessions" rowKey="email_key" selectedKey={str(cur?.email_key)} onRowClick={(r) => setSel(str(r.email_key))} cols={[
          { key: 'email_key', label: 'メール' },
          { key: 'sessions', label: 'セッション', num: true, fmt: fmtInt },
          { key: 'viewers', label: '商品閲覧者', num: true, fmt: fmtInt },
          { key: 'same_product_buyers', label: '同一商品の購入者', num: true, fmt: fmtInt },
          { key: 'same_product_rate', label: '同一商品の購入率', num: true, fmt: (v) => fmtPct(v), title: '閲覧した（人 × 商品）のうち、その商品を購入した割合' },
          { key: 'same_product_revenue', label: '同一商品の売上', num: true, fmt: fmtYen },
          { key: 'other_product_only_buyers', label: '別商品だけ購入', num: true, fmt: fmtInt },
          { key: 'rev_linear', label: '貢献売上（線形）', num: true, fmt: fmtYen },
        ]} />
      </Section>
      {cur && (
        <Section title={str(cur.email_key)}>
          <ol className="flow">
            {steps.map(([l, u, v], i) => (
              <li key={i}>
                <span className="flow-label">{l}</span>
                <span className="flow-value">{fmtInt(v)}</span>
                <span className="flow-unit">{u}</span>
                {(i === 1 || i === 3) && <span className="flow-rate">前の段階の {fmtPct(pct(v, steps[i - 1][2]))}</span>}
              </li>
            ))}
          </ol>
          <div className="stats">
            <Stat label="同一商品の売上" value={fmtYen(cur.same_product_revenue)} sub={`うち店舗 ${fmtPct(pct(cur.same_product_store_revenue, cur.same_product_revenue))}`} />
            <Stat label="購入までの日数（中央値）" value={`${fmtDec(cur.median_days_to_same_purchase)} 日`} />
            <Stat label="閲覧された商品" value={`${fmtInt(cur.distinct_products_viewed)} 点`} />
          </div>
          <h3 className="sub">閲覧された商品</h3>
          <DataTable rows={products} caption="閲覧された商品" initialSort="viewers" limit={20} cols={[
            { key: 'product_id', label: '商品ID' },
            { key: 'product_name', label: '商品名' },
            { key: 'category', label: 'カテゴリ' },
            { key: 'viewers', label: '閲覧者', num: true, fmt: fmtInt },
            { key: 'same_product_buyers', label: '同じ商品を購入', num: true, fmt: fmtInt },
            { key: 'same_product_rate', label: '購入率', num: true, fmt: (v) => fmtPct(v) },
            { key: 'same_product_revenue', label: '売上', num: true, fmt: fmtYen },
            { key: 'same_product_store_revenue', label: 'うち店舗', num: true, fmt: fmtYen },
          ]} />
        </Section>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
export function Quality({ b }: { b: Bundle }) {
  const k = b.kpi
  const c = b.meta.config || {}
  const rows: [string, string, string][] = [
    ['集計期間（Web）', `${fmtDate(k.web_from)} 〜 ${fmtDate(num(k.web_to) - 1)}`, ''],
    ['集計期間（POS）', `${fmtDate(k.pos_from)} 〜 ${fmtDate(k.pos_to)}`, ''],
    ['ヒット数', fmtInt(k.hits), ''],
    ['会員IDで識別できた人', fmtInt(k.members_seen), `訪問者 ${fmtInt(k.persons)} 人のうち ${fmtPct(pct(k.members_seen, k.persons))}`],
    ['流入タッチ（集約前 → 集約後）', `${fmtInt(k.raw_touches)} → ${fmtInt(k.collapsed_touches)}`, `ブラウザの戻る・進むなどで連続した同じタッチ ${fmtInt(k.collapsed_away)} 件を集約`],
    ['除外したリファラのヒット', fmtInt(k.excluded_referrer_hits), '決済サービスなど、タッチとして数えないリファラ'],
    ['除外したヒット', fmtInt(k.excluded_hits), 'touch.exclude_hit_condition に一致'],
    ['購入完了ヒット → CV', `${fmtInt(k.cv_hits)} → ${fmtInt(k.conversions)}`, '注文IDまたは時間で重複を除外'],
    ['注文IDがある CV', fmtPct(pct(k.cv_with_order_id, k.conversions)), ''],
    ['会員IDがある CV', fmtPct(pct(k.cv_with_member, k.conversions)), 'RFM・店舗購入との結合に使います'],
    ['購入商品が分かる CV', fmtPct(pct(k.cv_with_items, k.conversions)), 'ecommerce.items または POS 明細'],
    ['売上が分からない CV', fmtInt(k.cv_without_revenue), ''],
    ['タッチが無い CV', fmtInt(k.cv_without_touch), '遡り期間内に流入が見つからない'],
    ['商品IDが取れない商品詳細ページ', fmtPct(pct(k.pdp_without_product_id, k.pdp_hits)), 'pages.product_id_regex を確認'],
    ['ページ種別「その他」', fmtPct(pct(k.other_page_hits, k.hits)), '多い場合は pages.* の正規表現を追加'],
    ['POS 注文', fmtInt(k.pos_orders), `売上 ${fmtYen(k.pos_revenue)}（うち EC ${fmtPct(pct(k.pos_ec_revenue, k.pos_revenue))}）`],
    ['会員数', fmtInt(k.members_total), ''],
  ]
  return (
    <>
      <Section title="データの状態" note="数字が想定と大きく違う場合は、Treasure AI Studio で設定（params.yml）の見直しを依頼してください。">
        <div className="table-wrap">
          <table>
            <caption className="sr-only">データの状態</caption>
            <tbody>
              {rows.map(([l, v, n]) => <tr key={l}><th scope="row">{l}</th><td className="num">{v}</td><td className="muted">{n}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="設定">
        <dl className="config">
          <div><dt>Webログ</dt><dd>{c.sources?.weblog ?? '—'}</dd></div>
          <div><dt>会員</dt><dd>{c.sources?.member ?? '使用しない'}</dd></div>
          <div><dt>POS</dt><dd>{c.sources?.pos ?? '使用しない'}</dd></div>
          <div><dt>商品マスタ</dt><dd>{c.sources?.product ?? '使用しない'}</dd></div>
          <div><dt>出力先 DB</dt><dd>{c.output_database ?? '—'}</dd></div>
          <div><dt>人物の識別</dt><dd>{c.id_stitching === 'member' ? '会員IDで cookie を束ねる' : 'cookie 単位'}</dd></div>
          <div><dt>タッチの集約</dt><dd>{({ session: '同一セッション内の連続を集約', always: '連続していれば集約', none: '集約しない' } as Record<string, string>)[c.touch?.collapse_mode] ?? '—'}</dd></div>
          <div><dt>除外リファラ</dt><dd><code>{c.touch?.exclude_referrer_regex ?? '—'}</code></dd></div>
          <div><dt>RFM の F の閾値</dt><dd>{Array.isArray(c.rfm?.f_thresholds) ? c.rfm.f_thresholds.join(' / ') + ' 回' : '—'}</dd></div>
          <div><dt>Workflow</dt><dd>{b.meta.workflow?.project || '—'}{b.meta.workflow?.attempt_id ? `（attempt ${b.meta.workflow.attempt_id}）` : ''}</dd></div>
          <div><dt>データ作成日時</dt><dd>{b.meta.generated_at ? new Date(b.meta.generated_at).toLocaleString('ja-JP') : '—'}</dd></div>
        </dl>
      </Section>
    </>
  )
}
