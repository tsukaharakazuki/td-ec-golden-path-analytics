# td-ec-golden-path-analytics

EC の購買サイクル **流入 → 回遊 → 会員登録 → 購買 → 再訪問** のなかから、売上とロイヤル顧客につながる道筋（ゴールデンパス）を見つける、Treasure AI Studio 用の Skill です。

- **初期構築用の Skill** — このリポジトリの URL を Treasure AI Studio に渡すと、ヒアリングと実データの確認をしながら、集計 Workflow を組み立てます
- **運用 Skill** — 「最新にして」と頼むと、AI が Workflow を実行し、最新の値でダッシュボードを作り直します。広告・メール・ロイヤル顧客についての追加分析もします
- **ダッシュボード** — 1 ファイルで完結する HTML。ビューアー（GitHub Pages）で `bundle.json` を開くこともできます

ビューアー: https://tsukaharakazuki.github.io/td-ec-golden-path-analytics/

## はじめかた（Treasure AI Studio）

チャットに次の文を貼り付けます。

```text
https://github.com/tsukaharakazuki/td-ec-golden-path-analytics
このURLを読み込んで、ECゴールデンパス分析（td-ec-golden-path-analytics）の初期構築をしたいです。
```

AI がリポジトリ直下の [`SKILL.md`](./SKILL.md)（インストーラー）を読み、次の順に進めます。

| 段階 | AI がすること | あなたが答える・決めること |
|---|---|---|
| ヒアリング | 9 つのテーマ（A〜I）で質問（15〜30 分） | テーブルの場所、購入完了ページ、utm の付け方、店舗まで含めるか など |
| データ確認 | 読み取り専用のクエリで実データを確認し、設定値を提案 | 実行の承認、提案（購入完了の判定・除外するリファラ・チャネル分類・ページ分類）の採否 |
| Workflow 生成 | `params.yml` とチャネル分類を埋め、静的検査 | 設定一覧の最終確認 |
| push・初回実行 | `tdx wf push` → `tdx wf run` | push と実行の承認 |
| ダッシュボード | 結果を抽出して HTML を作成 | — |
| 配置 | 運用 Skill を作業フォルダ（my 以外）の `.claude/skills/` に配置 | — |

各段階の終わりに `MEMORY.md` へ追記します。

分からない項目は「後で」と答えれば未確認として残り、完了報告に一覧で出ます。

### 作業フォルダと MEMORY.md

生成物はすべて **`my` 以外の共有フォルダ**（既定は `golden-path/`）に置きます。Treasure AI Studio の `my` フォルダは本人しかアクセスできず、他のメンバーに共有できないためです。CLI も `my` の中への書き出しをエラーにします。

```text
<共有フォルダ>/golden-path/                       ← my 以外
├─ MEMORY.md                                     ← 作業記録（時系列・担当者の引き継ぎ用）
├─ golden_path/                                  ← Workflow プロジェクト
├─ _discovery/                                   ← データ確認用 SQL
├─ golden_path_reports/<YYYYMMDD>/               ← bundle.json・ダッシュボード HTML
└─ .claude/skills/td-ec-golden-path-analytics/   ← 運用 Skill（config/install.yml）
```

構築と運用は段階を追って担当者をまたいで進むので、各段階の内容・確定した設定・要確認事項・次にやることを、日時と担当者付きで `MEMORY.md` に時系列（古い順）で残します。次の担当者は最後のエントリから続けられます。詳しくは [Treasure AI Studio で使う](./docs/TREASURE_AI_STUDIO.md)。

## 日々の更新

構築後は、作業フォルダで次のように頼みます。

```text
ゴールデンパス分析を最新にしてください。
Workflow を実行して、終わったらダッシュボードを更新してください。
```

AI が `tdx wf run` で Workflow を実行し、完了を確認してから中間テーブルを抽出し、`golden-path/golden_path_reports/<日付>/golden-path-dashboard.html` を作って、MEMORY.md に記録します。定期実行にしたい場合は `golden_path.dig` の `schedule` を有効にして push します。

追加分析の例:

```text
PMax（google / cpc / pmax_all_products）は、実際の購買にどう貢献している？ 新規と既存で違う？
メール「season_sale」で見られた商品は、同じ商品が買われている？ 店舗も含めて
ロイヤル顧客はアウターをどんな経路で買っている？
ゴールデンパスの重みを、再購入率重視に変えたい
```

## 分析の中身

使うデータ:

| データ | 使い方 |
|---|---|
| Webログ（td-js-sdk） | ヒット → セッション → 流入タッチ（utm・広告クリックID・リファラ）、ページ種別、商品閲覧、購入完了（Thanks URL・注文ID）。GA4 の `ecommerce` が取り込まれていれば購入商品も |
| 会員データ | 性別・年代・都道府県、会員登録日 |
| POS（店舗＋EC） | RFM、店舗での購入、再購入、メールで見た商品の店舗購入 |
| 商品マスタ（任意） | カテゴリ・ブランド・商品名 |

中間テーブル:

1. **RFM マトリクス** — POS から R・F・M を各 5 段階にした 125 ブロック。F は同値が多いため既定は閾値で分割
2. **アトリビューション** — CV ごとに最大 12 世代・30 日を遡り、ラストクリック／ファーストクリック／線形／逓減／U 字で配分
   - ブラウザの戻る・進むで同じ utm 付き URL が再記録される問題（`pmax → 内部 → 内部 → pmax`）は、指定した粒度で同じタッチが続いた場合に 1 世代へ集約
   - 決済サービスや会員アプリなど、購入直前に挟まる外部リファラは、実データから候補を出して除外
3. **購買サイクル** — 流入チャネル別の 回遊・会員・購買・再訪問・再購入

ゴールデンパス分析:

- **Q1** ロイヤル顧客は、買っている商品ごとに、どのような流入経路・サイト内行動をしているか
- **Q2** 特定の広告が、実際の購買にどう貢献しているか（モデル別・役割・新規率・再購入・商品）
- **Q3** 特定のメールが、どの商品ページを閲覧させ、同じ商品の購入につながったか（Web・店舗）
- **スコアリング** — 流入経路 × サイト内行動 × 商品グループの候補を、CVR・ロイヤル率・再購入率・客単価・件数のリフト（少数サンプルは平均に寄せて補正）でスコア化し、入口が偏らないように上位を採用

詳しくは [集計ロジック](./skills/td-ec-golden-path-analytics/references/methodology.md)。

## 構成

```text
td-ec-golden-path-analytics/
├── SKILL.md                         # 初期構築（インストーラー）
├── MANIFEST.txt                     # git が使えない環境向けのファイル一覧
├── skills/td-ec-golden-path-analytics/   # 作業フォルダの .claude/skills/ に配置される運用 Skill
│   ├── SKILL.md                     # 最新化・ダッシュボード更新・追加分析・設定変更・調査
│   ├── references/
│   │   ├── hearing.md               # ヒアリング項目（A〜I）
│   │   ├── data-discovery.md        # データ確認の手順と結果の読み方
│   │   ├── methodology.md           # 集計ロジック
│   │   └── analysis-playbook.md     # 追加分析の SQL
│   ├── workflow/golden_path/        # Treasure Workflow のテンプレート
│   │   ├── golden_path.dig          # 親（01_prep → 02_marts → 03_golden → 04_dash）
│   │   ├── workflows/*.dig
│   │   ├── config/params.yml        # 顧客ごとの設定はここ（＋ channel_rules.sql）
│   │   ├── queries/                 # Trino SQL（46 本）
│   │   ├── manifest.yml / tdx.json
│   ├── discovery/*.sql              # データ確認用（読み取り専用）
│   ├── export/*.sql                 # ダッシュボード用の抽出
│   ├── scripts/gp-cli.mjs           # 検査・SQL 書き出し・bundle 作成・HTML 生成・作業記録（Node.js 18+、依存なし）
│   └── assets/dashboard-template.html
├── dashboard/                       # ダッシュボードのソース（React + ECharts、1 ファイルにビルド）
├── docs/
│   ├── TREASURE_AI_STUDIO.md        # Studio での使い方とプロンプト
│   └── BUNDLE_FORMAT.md             # bundle.json の形式
└── tests/
    ├── cli.test.mjs                 # CLI のテスト
    └── sql_smoke/                   # 合成データで Workflow を DuckDB 上で通すテスト
```

## 出力テーブル

`<出力DB>.gp_*`（`params.yml` の `common.database`）。

| 段階 | テーブル |
|---|---|
| 01_prep | `gp_hits` `gp_sessions` `gp_touchpoints` `gp_touch_dim` `gp_conversions` `gp_cv_items` `gp_orders` `gp_order_lines` `gp_members` `gp_id_map` `gp_product_master` `gp_product_dim` `gp_channel_rules` |
| 02_marts | `gp_rfm_customer` `gp_rfm_matrix` `gp_rfm_segments` `gp_attribution_credits` `gp_attribution_summary` `gp_attribution_channel` `gp_cv_journey` `gp_cv_journey_items` `gp_open_journeys` `gp_path_length` `gp_top_paths` `gp_lifecycle` `gp_funnel_summary` `gp_freq_orders` `gp_freq_final` `gp_freq_links` `gp_freq_nodes` `gp_freq_outcome` `gp_freq_combos` |
| 03_golden | `gp_loyal_product_paths` `gp_loyal_behavior_stats` `gp_ad_contribution` `gp_ad_product` `gp_email_view_purchase` `gp_email_influence` `gp_email_product` `gp_golden_path_candidates` `gp_golden_paths` |
| 04_dash | `gp_dash_kpi` |

毎回の実行で全テーブルを作り直します（Webログは `common.weblog_lookback_days` 日、POS は `pos_lookback_days` 日）。

## CLI

```sh
S=skills/td-ec-golden-path-analytics
node $S/scripts/gp-cli.mjs check $S/workflow/golden_path                           # 設定とWorkflowの静的検査
node $S/scripts/gp-cli.mjs discovery-sql --params <params.yml> --out _discovery    # データ確認用SQL
node $S/scripts/gp-cli.mjs export-sql --db golden_path_mart --out out/sql          # ダッシュボード用の抽出SQL
node $S/scripts/gp-cli.mjs bundle --in out/data --params <params.yml> --client "顧客名" --out out/bundle.json
node $S/scripts/gp-cli.mjs dashboard --bundle out/bundle.json --out out/golden-path-dashboard.html [--by 山田]   # 上位に MEMORY.md があれば 1 行追記
node $S/scripts/gp-cli.mjs memory golden-path --by 山田 --stage ヒアリング --status 中断 \
  --summary "A〜E を確定" --open "POS の店舗コード（店舗運営に確認）" --next "F から再開"           # MEMORY.md に時系列で追記（無ければ作成）
```

TD には接続しません。SQL の実行は `tdx query` で行います。出力先が `my` フォルダの中だとエラーになります（`check` も `my` の中の Workflow をエラーにします）。

## 開発

```sh
# ダッシュボード（Node.js 20+）
cd dashboard && npm ci && npm run dev
npm run build        # dist/index.html と skills/.../assets/dashboard-template.html を更新
npm test             # CLI のテスト

# Workflow の SQL を合成データで通す（Python 3.10+）
pip install duckdb sqlglot pyyaml
python3 tests/sql_smoke/generate_data.py /tmp/gp.duckdb
python3 tests/sql_smoke/run.py /tmp/gp.duckdb --export /tmp/gp-export --playbook
```

`sql_smoke` は Trino の SQL を sqlglot で DuckDB に変換し、TD 固有の関数（`TD_INTERVAL` など）を置き換えて実行します。構造・カラム参照・ロジックの確認用で、TD 上の動作確認の代わりにはなりません。サンプルのダッシュボード（`dashboard/public/sample-bundle.json`）は、この合成データ（架空のアパレル EC）から作っています。

`main` への push で GitHub Actions がテスト・ビルドし、GitHub Pages に公開します（Settings → Pages の Source は GitHub Actions）。

## 関連

- [td_tas_skill_extension](https://github.com/tsukaharakazuki/td_tas_skill_extension) — Treasure Data / Treasure AI Studio 向けの Skill 集
- [Treasure AI Data Catalog](https://github.com/tsukaharakazuki/treasure-ai-data-catalog) — データカタログの作成とビューアー
