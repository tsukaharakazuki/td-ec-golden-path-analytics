import { useEffect, useState } from 'react'
import { embeddedBundle, fmtDate, num, parseBundle, type Bundle } from './data'
import { REPO_URL, SETUP_PROMPT, UPDATE_PROMPT } from './prompts'
import { Ads, Attribution, Email, Golden, Loyal, Overview, Quality, Rfm } from './views'

const TABS = [
  { id: 'overview', label: '概要' },
  { id: 'golden', label: 'ゴールデンパス' },
  { id: 'attribution', label: 'アトリビューション' },
  { id: 'rfm', label: 'RFM' },
  { id: 'loyal', label: 'ロイヤル顧客の買い方' },
  { id: 'ads', label: '広告の貢献' },
  { id: 'email', label: 'メールと商品' },
  { id: 'quality', label: 'データと設定' },
]

function initialTab() {
  const h = location.hash.replace('#', '')
  return TABS.some((t) => t.id === h) ? h : 'overview'
}

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(() => {
    try { return embeddedBundle() } catch { return null }
  })
  const [embedded] = useState(() => !!bundle)
  const [tab, setTab] = useState(initialTab)
  const [error, setError] = useState('')

  useEffect(() => {
    const onHash = () => setTab(initialTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (bundle?.meta.client) document.title = `${bundle.meta.client} ゴールデンパス分析`
  }, [bundle])

  const go = (id: string) => {
    history.replaceState(null, '', `#${id}`)
    setTab(id)
    window.scrollTo({ top: 0 })
  }
  const load = async (file: File) => {
    try {
      setBundle(parseBundle(JSON.parse(await file.text())))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const openSample = async () => {
    try {
      const res = await fetch('./sample-bundle.json')
      if (!res.ok) throw new Error('サンプルを読み込めませんでした')
      setBundle(parseBundle(await res.json()))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!bundle) return <Landing onFile={load} onSample={openSample} error={error} />

  const k = bundle.kpi
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M4 24 C 10 24, 10 8, 16 8 S 22 24, 28 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <circle cx="4" cy="24" r="3" fill="currentColor" /><circle cx="16" cy="8" r="3" fill="currentColor" /><circle cx="28" cy="24" r="3.5" fill="var(--gold)" />
          </svg>
          <div>
            <h1>{bundle.meta.client ? `${bundle.meta.client} ` : ''}ゴールデンパス分析</h1>
            <p className="period">
              Web {fmtDate(k.web_from)} 〜 {fmtDate(num(k.web_to) - 1)}
              {bundle.meta.generated_at && <> ／ 更新 {new Date(bundle.meta.generated_at).toLocaleDateString('ja-JP')}</>}
            </p>
          </div>
        </div>
        {!embedded && (
          <label className="button ghost">
            別のデータを開く
            <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} hidden />
          </label>
        )}
      </header>
      <nav className="tabs" aria-label="表示の切り替え">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(t.id) }}>{t.label}</a>
        ))}
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
      <main className="main" key={tab}>
        {tab === 'overview' && <Overview b={bundle} go={go} />}
        {tab === 'golden' && <Golden b={bundle} />}
        {tab === 'attribution' && <Attribution b={bundle} />}
        {tab === 'rfm' && <Rfm b={bundle} />}
        {tab === 'loyal' && <Loyal b={bundle} />}
        {tab === 'ads' && <Ads b={bundle} />}
        {tab === 'email' && <Email b={bundle} />}
        {tab === 'quality' && <Quality b={bundle} />}
      </main>
    </div>
  )
}

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="copy-block">
      <pre aria-label={label}>{text}</pre>
      <button type="button" className="button" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600) }}>
        {done ? 'コピーしました' : 'コピー'}
      </button>
    </div>
  )
}

function Landing({ onFile, onSample, error }: { onFile: (f: File) => void; onSample: () => void; error: string }) {
  const [drag, setDrag] = useState(false)
  return (
    <div className="landing">
      <header className="landing-head">
        <svg className="landing-route" viewBox="0 0 640 120" aria-hidden="true">
          <path d="M20 90 C 120 90, 130 30, 230 30 S 340 90, 430 90 S 540 30, 620 30" fill="none" stroke="var(--gold)" strokeWidth="5" strokeLinecap="round" />
          {[[20, 90], [230, 30], [430, 90]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="9" fill="var(--surface)" stroke="var(--ink)" strokeWidth="4" />)}
          <rect x="608" y="18" width="24" height="24" rx="5" fill="var(--gold)" />
        </svg>
        <h1>EC ゴールデンパス分析</h1>
        <p className="lead">
          流入 → 回遊 → 会員登録 → 購買 → 再訪問。Treasure Data の Webログ・会員・POS から、売上とロイヤル顧客につながる道筋を見つけるダッシュボードです。
        </p>
      </header>

      <div className="landing-grid">
        <section className="panel">
          <h2>ダッシュボードを開く</h2>
          <p>Treasure AI Studio が作った <code>bundle.json</code> を選ぶか、ここにドロップしてください。データはこのブラウザの中だけで読み込まれ、どこにも送信されません。</p>
          <label
            className={`drop${drag ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
          >
            <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <span>bundle.json を選ぶ</span>
          </label>
          <button type="button" className="button ghost" onClick={onSample}>架空のアパレル EC のサンプルを見る</button>
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        <section className="panel">
          <h2>Treasure AI Studio で始める</h2>
          <p>初めて使うときは、次の文を Treasure AI Studio のチャットに貼り付けます。データの場所や購入完了の判定方法などをヒアリングしながら、集計 Workflow を組み立てます。</p>
          <CopyBlock text={SETUP_PROMPT} label="初期構築のプロンプト" />
          <p>構築後は、次のように頼むと Workflow を実行してダッシュボードを作り直します。</p>
          <CopyBlock text={UPDATE_PROMPT} label="日次更新のプロンプト" />
          <p className="muted"><a href={REPO_URL}>GitHub リポジトリ</a> に手順と集計ロジックの説明があります。</p>
        </section>
      </div>
    </div>
  )
}
