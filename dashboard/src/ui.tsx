import { useMemo, useState, type ReactNode } from 'react'
import { behaviorSteps, num, pathSteps, str, type Row, type Step } from './data'

export function Section({ title, note, children, actions }: { title: string; note?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <div>
          <h2>{title}</h2>
          {note && <p className="note">{note}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { id: T; label: string; help?: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? 'on' : ''}
          title={o.help}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select({ value, options, onChange, label }: {
  value: string
  options: { id: string; label: string }[]
  onChange: (v: string) => void
  label: string
}) {
  return (
    <label className="select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

// ---------------------------------------------------------------------------
// Route: the golden path drawn as a line with stations.
// Channels are filled stations, on-site pages are hollow stations, the product group is the terminal.
export function Route({ path, behavior, product, compact }: { path?: unknown; behavior?: unknown; product?: unknown; compact?: boolean }) {
  const channels = pathSteps(path)
  const pages = behaviorSteps(behavior)
  const prod = str(product)
  const parts: { kind: 'leg'; title: string; steps: Step[] }[] = []
  if (channels.length) parts.push({ kind: 'leg', title: '流入', steps: channels })
  if (pages.length) parts.push({ kind: 'leg', title: 'サイト内', steps: pages })
  return (
    <div className={`route${compact ? ' compact' : ''}`}>
      {parts.map((leg, li) => (
        <div className="route-leg" key={li}>
          <div className="route-leg-title">{leg.title}</div>
          <ol className="route-line">
            {leg.steps.map((s, i) => (
              <li key={i} className={`station ${s.kind}`}>
                <span className="dot" aria-hidden="true" />
                <span className="station-label">
                  {s.label}
                  {s.count && <span className="count">{s.count}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {prod && (
        <div className="route-leg terminal-leg">
          <div className="route-leg-title">購入</div>
          <div className="terminal">
            <span className="dot" aria-hidden="true" />
            <span className="station-label">{prod}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Score contribution: one bar per component, centered at 0 (-1..1). */
export function ComponentBars({ row, items }: { row: Row; items: { col: string; label: string; lift: string; help: string; id: string }[] }) {
  return (
    <div className="comp-bars">
      {items.map((c) => {
        const v = num(row[c.col])
        const val = Number.isNaN(v) ? 0 : Math.max(-1, Math.min(1, v))
        const lift = num(row[c.lift])
        const liftText = c.id === 'support' ? `${Math.round(lift)} 件` : Number.isNaN(lift) ? '—' : `×${lift.toFixed(2)}`
        return (
          <div className="comp" key={c.id} title={c.help}>
            <span className="comp-label">{c.label}</span>
            <span className="comp-track">
              <span className="comp-zero" />
              <span
                className={`comp-fill ${val >= 0 ? 'pos' : 'neg'}`}
                style={val >= 0 ? { left: '50%', width: `${val * 50}%` } : { right: '50%', width: `${-val * 50}%` }}
              />
            </span>
            <span className="comp-value">{liftText}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
export interface Col {
  key: string
  label: string
  fmt?: (v: unknown, row: Row) => ReactNode
  num?: boolean
  width?: string
  title?: string
}

export function DataTable({ rows, cols, initialSort, limit = 50, onRowClick, selectedKey, rowKey, caption }: {
  rows: Row[]
  cols: Col[]
  initialSort?: string
  limit?: number
  onRowClick?: (r: Row) => void
  selectedKey?: string
  rowKey?: string
  caption: string
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initialSort || '', desc: true })
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => {
    if (!sort.key) return rows
    const c = cols.find((x) => x.key === sort.key)
    return [...rows].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      let d: number
      if (c?.num) {
        const an = num(av), bn = num(bv)
        d = (Number.isNaN(an) ? -Infinity : an) - (Number.isNaN(bn) ? -Infinity : bn)
      } else d = str(av).localeCompare(str(bv), 'ja')
      return sort.desc ? -d : d
    })
  }, [rows, cols, sort])
  const shown = showAll ? sorted : sorted.slice(0, limit)
  const copy = () => {
    const lines = [cols.map((c) => c.label).join('\t'), ...sorted.map((r) => cols.map((c) => str(r[c.key])).join('\t'))]
    navigator.clipboard?.writeText(lines.join('\n'))
  }
  if (!rows.length) return <Empty>このデータはありません。</Empty>
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined} title={c.title}
                aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                <button type="button" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                  {c.label}
                  {sort.key === c.key && <span aria-hidden="true">{sort.desc ? ' ▾' : ' ▴'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const key = rowKey ? str(r[rowKey]) : String(i)
            return (
              <tr key={key + i} className={`${onRowClick ? 'clickable' : ''} ${selectedKey !== undefined && key === selectedKey ? 'selected' : ''}`}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r) } } : undefined}>
                {cols.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>{c.fmt ? c.fmt(r[c.key], r) : str(r[c.key])}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="table-foot">
        <span>{sorted.length} 行{sorted.length > limit && !showAll ? `（上位 ${limit} 行を表示）` : ''}</span>
        <span className="table-actions">
          {sorted.length > limit && (
            <button type="button" className="link" onClick={() => setShowAll((v) => !v)}>{showAll ? '上位だけ表示' : 'すべて表示'}</button>
          )}
          <button type="button" className="link" onClick={copy}>TSV でコピー</button>
        </span>
      </div>
    </div>
  )
}
