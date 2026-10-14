import { useEffect, useRef, useState } from 'react'
import { BRAND_ICON, Icon, type IconName } from './brand'
import { embeddedBundle, fmtDate, num, parseBundle, type Bundle } from './data'
import { REPO_URL, SETUP_PROMPT, UPDATE_PROMPT } from './prompts'
import { Ads, Attribution, Email, Golden, Loyal, Overview, Quality, Rfm } from './views'
import { Frequency } from './frequency'

const APP_NAME = 'Treasure AI Golden Path'

const TABS: { id: string; label: string; icon: IconName; lead: string }[] = [
  { id: 'overview', label: '概要', icon: 'overview', lead: '集計期間の購買サイクルと、いま有力なゴールデンパス。' },
  { id: 'golden', label: 'ゴールデンパス', icon: 'golden', lead: '流入経路・サイト内行動・購入商品の組み合わせをスコア化したパターン。' },
  { id: 'attribution', label: 'アトリビューション', icon: 'attribution', lead: 'チャネルとタッチごとの購買貢献を、複数のモデルで比べます。' },
  { id: 'rfm', label: 'RFM', icon: 'rfm', lead: '最近の購入・購入回数・購入金額で顧客を分けた分布とセグメント。' },
  { id: 'frequency', label: '購入回数の推移', icon: 'frequency', lead: '初回から N 回目までの購入で、買うもの（カテゴリ・ブランド・金額帯など）がどう移り変わり、どのランクに育ったか。' },
  { id: 'loyal', label: 'ロイヤル顧客の買い方', icon: 'loyal', lead: 'ロイヤル顧客とそれ以外で、買い方と行動がどう違うか。' },
  { id: 'ads', label: '広告の貢献', icon: 'ads', lead: '広告ごとの購買貢献と、経路の中での役割。' },
  { id: 'email', label: 'メールと商品', icon: 'email', lead: 'メール経由で閲覧した商品が、同じ人に購入されたか。' },
  { id: 'quality', label: 'データと設定', icon: 'quality', lead: '集計に使ったデータの状態と設定。' },
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
  const content = useRef<HTMLElement>(null)

  useEffect(() => {
    const onHash = () => setTab(initialTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    document.title = bundle?.meta.client ? `${bundle.meta.client} ゴールデンパス分析` : APP_NAME
  }, [bundle])

  const go = (id: string) => {
    history.replaceState(null, '', `#${id}`)
    setTab(id)
    content.current?.scrollTo({ top: 0 })
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

  if (!bundle) {
    return (
      <div className="app">
        <header className="topbar">
          <a className="brand" href="#"><img src={BRAND_ICON} alt="" /> {APP_NAME}</a>
        </header>
        <main className="landing-main">
          <Landing onFile={load} onSample={openSample} error={error} />
        </main>
      </div>
    )
  }

  const k = bundle.kpi
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]
  const title = `${bundle.meta.client ? `${bundle.meta.client} ` : ''}ゴールデンパス分析`
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#overview" onClick={(e) => { e.preventDefault(); go('overview') }}><img src={BRAND_ICON} alt="" /> {APP_NAME}</a>
        <div className="app-title">
          <strong>{title}</strong>
          {bundle.meta.generated_at && <span className="badge">更新 {new Date(bundle.meta.generated_at).toLocaleDateString('ja-JP')}</span>}
        </div>
        {!embedded && (
          <div className="topbar-actions">
            <label className="button ghost small">
              別のデータを開く
              <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }} hidden />
            </label>
          </div>
        )}
      </header>
      {error && <div className="banner error" role="alert">{error}</div>}
      <div className="shell">
        <nav className="sidebar" aria-label="表示の切り替え">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} title={t.label} aria-current={tab === t.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(t.id) }}>
              <Icon name={t.icon} /> <span>{t.label}</span>
            </a>
          ))}
          <div className="sidebar-foot">
            {bundle.meta.client && <div>{bundle.meta.client}</div>}
            <div>Web {fmtDate(k.web_from)} 〜 {fmtDate(num(k.web_to) - 1)}</div>
          </div>
        </nav>
        <main className="content" ref={content}>
          <div className="view" key={tab}>
            <header className="page-head">
              <div>
                <p className="eyebrow">{title}</p>
                <h2>{current.label}</h2>
                <p className="muted">{current.lead}</p>
              </div>
              <p className="period">Web {fmtDate(k.web_from)} 〜 {fmtDate(num(k.web_to) - 1)}</p>
            </header>
            {tab === 'overview' && <Overview b={bundle} go={go} />}
            {tab === 'golden' && <Golden b={bundle} />}
            {tab === 'attribution' && <Attribution b={bundle} />}
            {tab === 'rfm' && <Rfm b={bundle} />}
            {tab === 'frequency' && <Frequency b={bundle} />}
            {tab === 'loyal' && <Loyal b={bundle} />}
            {tab === 'ads' && <Ads b={bundle} />}
            {tab === 'email' && <Email b={bundle} />}
            {tab === 'quality' && <Quality b={bundle} />}
          </div>
        </main>
      </div>
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="button ghost small" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600) }}>
      {done ? 'コピーしました' : label}
    </button>
  )
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'golden', title: 'ゴールデンパス', text: '流入 → 回遊 → 購入商品の組み合わせを、CVR・ロイヤル率・再購入率・客単価でスコア化' },
  { icon: 'attribution', title: 'アトリビューション', text: 'ラストクリック・線形・U字などのモデルで、チャネルの評価の違いを比較' },
  { icon: 'rfm', title: 'RFM', text: 'R × F マトリクスとセグメントで、売上を支える顧客層を把握' },
  { icon: 'frequency', title: '購入回数の推移', text: '初回〜N 回目の購入でカテゴリ・ブランド・金額帯がどう移り、どの累計金額ランクに育ったかをサンキー図で' },
  { icon: 'loyal', title: 'ロイヤル顧客の買い方', text: 'ロイヤル顧客が最初に買った商品や、よく見るページの違い' },
  { icon: 'ads', title: '広告の貢献', text: '購入直前以外のアシストも含めた、広告ごとの役割と貢献商品' },
  { icon: 'email', title: 'メールと商品', text: 'メールで見た商品を、Web・店舗で同じ人が買ったか' },
]

function Landing({ onFile, onSample, error }: { onFile: (f: File) => void; onSample: () => void; error: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Treasure AI Studio × Treasure Data</p>
        <h1>
          EC <span className="gradient">Golden Path</span> Analytics
        </h1>
        <p className="lead">
          流入 → 回遊 → 会員登録 → 購買 → 再訪問。Treasure Data の Webログ・会員・POS から、売上とロイヤル顧客につながる道筋を見つけるダッシュボードです。
          データはこのブラウザの中だけで読み込み、どこにも送信しません。
        </p>

        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}
        >
          <Icon name="upload" size={28} />
          <strong>bundle.json をドロップ、またはクリックして選択</strong>
          <span className="muted">Treasure AI Studio が作成したダッシュボード用データ</span>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }}
          />
        </div>
        {error && <pre className="error-box" role="alert">{error}</pre>}
        <div className="hero-actions">
          <button type="button" className="button" onClick={onSample}>架空のアパレル EC のサンプルを開く</button>
          <a className="button ghost" href={REPO_URL} target="_blank" rel="noreferrer noopener"><Icon name="github" size={15} /> GitHub</a>
        </div>
      </section>

      <section className="steps">
        <h2>使い方</h2>
        <ol>
          <li>
            <strong>Treasure AI Studio にプロンプトを貼り付ける</strong>
            <p>データの場所や購入完了の判定方法などをヒアリングしながら、集計 Workflow を組み立てます。</p>
            <div className="prompt-box">
              <pre aria-label="初期構築のプロンプト">{SETUP_PROMPT}</pre>
              <CopyButton text={SETUP_PROMPT} label="初期構築のプロンプトをコピー" />
            </div>
          </li>
          <li>
            <strong>bundle.json をダウンロードしてここで開く</strong>
            <p>ゴールデンパス・アトリビューション・RFM・広告とメールの貢献を画面で確認します。</p>
          </li>
          <li>
            <strong>定期更新</strong>
            <p>構築後は、次のように頼むと Workflow を実行してダッシュボードを作り直します。</p>
            <div className="prompt-box">
              <pre aria-label="日次更新のプロンプト">{UPDATE_PROMPT}</pre>
              <CopyButton text={UPDATE_PROMPT} label="更新用プロンプトをコピー" />
            </div>
          </li>
        </ol>
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <div className="feature" key={f.title}>
            <Icon name={f.icon} size={18} />
            <strong>{f.title}</strong>
            <p>{f.text}</p>
          </div>
        ))}
        <div className="feature">
          <Icon name="lock" size={18} />
          <strong>ローカルファースト</strong>
          <p>サーバーはありません。TD への接続・API キーの受け渡しもしません。</p>
        </div>
      </section>
    </div>
  )
}
