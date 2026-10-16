---
name: td-ec-golden-path-analytics-setup
description: EC の購買サイクル（流入→回遊→会員登録→購買→再訪問）のゴールデンパス分析を、Treasure AI Studio の共有の作業フォルダ（本人しか開けない「my」以外）へ対話しながら初期構築し、経緯を MEMORY.md に時系列で記録する。Webログ（td-js-sdk）・会員・POS のテーブルとカラム、購入完了の判定、ページ分類、流入タッチと除外リファラ、RFM・アトリビューション・スコアの設定をヒアリングし、実データの確認結果から設定値を提案して、集計 Workflow（golden_path）を生成・検証・push・初回実行し、ダッシュボードを作る。「このURLを読み込んでゴールデンパス分析を設定したい」「td-ec-golden-path-analytics を構築」「ゴールデンパス分析の初期構築」「ゴールデンパスの設定を変更したい」などで発動する。
---

# td-ec-golden-path-analytics 初期構築

このファイルは **インストーラー** です。利用者がこのリポジトリの URL を渡して「設定したい」と依頼したら、以下の手順で対話しながら構築します。構築後の日々の運用（Workflow 実行 → ダッシュボード更新、追加分析、設定変更）は、作業フォルダに配置する `skills/td-ec-golden-path-analytics/SKILL.md` が担当します。

- リポジトリ: `https://github.com/tsukaharakazuki/td-ec-golden-path-analytics`
- Raw URL の基点: `https://raw.githubusercontent.com/tsukaharakazuki/td-ec-golden-path-analytics/main/`
- ダッシュボード（ビューアー）: `https://tsukaharakazuki.github.io/td-ec-golden-path-analytics/`

以下、取得したリポジトリのルートを `$REPO`、Skill 本体 `$REPO/skills/td-ec-golden-path-analytics` を `$SKILL`、作業フォルダ（「my」以外の共有フォルダに作る `golden-path/`。Step 2 で決める）を `$WORK` と書きます。手順中の `<作業フォルダ>` も `$WORK` を指します。

## 全体像

```text
Step 0  開始の宣言
Step 1  ファイルの取得
Step 2  作業フォルダ（my 以外）の決定と MEMORY.md の確認、接続先（tdx）・既存インストールの確認
Step 3  ヒアリング（references/hearing.md の A〜I）
Step 4  データ確認（承認制・読み取り専用）→ 設定値の提案（CV 判定・ページ分類・チャネル・除外リファラ）
Step 5  Workflow の生成（params.yml / channel_rules.sql）と静的検査
Step 6  push と初回実行（承認制）
Step 7  ダッシュボードの作成
Step 8  運用 Skill の配置と完了報告
（各 Step の終わり・中断するときに MEMORY.md へ追記）
```

## 守ること

1. **推測で埋めない。** DB 名・テーブル名・カラム名・URL パターンは、利用者の回答か、利用者が承認したクエリの結果で確認できたものだけを書く。不明なものは `<TO_BE_CONFIRMED>` のまま残し、報告の「未確認事項」に挙げる。カラム名が似ているだけで確定しない。
2. **1 回の質問は 1 テーマ。** `AskUserQuestion` が使える環境では選択肢付きで、1 回に最大 4 問。使えない環境では番号付きの短い質問。各テーマの最後に確定内容を箇条書きで復唱してから次へ進む。
3. **tdx の実行は事前に承認を取る。** 実行するコマンドと目的を示してから実行する。Step 4 までに使ってよいのは読み取り専用の操作（`tdx status` / `tdx databases` / `tdx tables` / `tdx describe` / `tdx query` の SELECT）だけ。`time` 列があるテーブルは必ず `TD_INTERVAL` で絞り、`LIMIT` を付ける。
4. **TD への書き込みは個別に承認を取る。** `tdx wf push`、`tdx wf run`、出力 DB の作成は Step 6 で、それぞれ内容を示して明示的な了承を得てから行う。`-y` は付けない。既存の Workflow プロジェクトやテーブルを上書きする場合は、その旨を必ず伝える。
5. **個人情報を出さない。** サンプル確認で会員ID・メールアドレス・氏名・電話・住所などの生値をチャットやファイルに出さない。件数・割合・形式（桁数、先頭数文字のマスク）で確認する。
6. **秘密情報を書かない。** API キー、パスワード、Webhook URL を設定ファイル・Skill・チャットに書かない。
7. **集計ロジック（SQL）は原則変更しない。** 顧客ごとの違いは `config/params.yml` と `queries/01_prep/channel_rules.sql` で吸収する。どうしても SQL を変える場合は、理由と変更箇所を報告と MEMORY.md に書く。
8. **生成物を「my」フォルダに置かない。** Treasure AI Studio では本人しかアクセスできない `my` フォルダが作られる。ここに置くと他のメンバーに共有できないため、Workflow プロジェクト・`_discovery/`・レポートとダッシュボード・運用 Skill（`.claude/skills/`）・`install.yml`・MEMORY.md は、必ず `my` 以外のフォルダを作成してその中（`$WORK`）に置く（Step 2）。`gp-cli.mjs` も `my` の中への書き出しをエラーにし、`check` は `my` の中の Workflow をエラーにする。`tdx query --output` などの出力先も `$WORK` にする。
9. **作業を MEMORY.md に時系列で記録する。** 構築は段階を追って、担当者をまたいで進む。開始時に `$WORK/MEMORY.md` を読み、各 Step を終えたとき・設定が確定したとき・中断や回答待ちになるときに追記する（下の「作業記録」）。

## 作業記録（MEMORY.md）

- 場所は `$WORK/MEMORY.md`。追記は古い順（下に足す）。過去のエントリは書き換えず、訂正は新しいエントリで行う。
- 追記には CLI を使う（書式がそろう。日時は自動）:
  ```bash
  node $SKILL/scripts/gp-cli.mjs memory $WORK --by "<担当者>" --stage "<段階>" --status 進行中 \
    --summary "<1行の要約>" \
    --done $'<実施したこと>\n<実施したこと>' \
    --decided $'<決定・確認済み（根拠）>' \
    --open $'<未解決・要確認（誰に聞くか）>' \
    --next $'<次にやること>'
  ```
  `--status` は `進行中` / `完了` / `中断`。`--stage` は Step の名前（準備、ヒアリング、データ確認、Workflow生成、push・初回実行、ダッシュボード作成、初期構築完了 など）。
- 書くのは引き継ぎの材料（確定した設定とその根拠、`<TO_BE_CONFIRMED>` と確認先、承認したこと、次の手順）。API キー・トークン・Webhook URL・個人情報の生値・クエリ結果の生データは書かない（CLI も API キーやメールアドレスらしき文字列を拒否する）。
- 利用者の回答待ちで止まるときは、何を待っているかを `--status 中断` で書いてから止める。

## Step 0: 開始の宣言

```text
ECゴールデンパス分析の初期構築を始めます。
1. 必要なファイルを取得します
2. 共有の作業フォルダ（本人しか開けない「my」以外）を決め、Treasure Data の接続先を確認します。
   作業の経緯はその中の MEMORY.md に時系列で残し、他の担当者が続きから引き継げるようにします
3. データの場所と判定ルールを、9つのテーマ（A〜I）で質問します（15〜30分程度）
4. ご了承いただければ、実データを読み取り専用で確認し、購入完了の判定や除外すべきリファラを提案します
5. 集計 Workflow を作って push・実行し、ダッシュボードを作ります（push と実行の前に確認します）
分からない項目は「後で」と答えていただければ、未確認として残して先に進めます。
```

## Step 1: ファイルの取得

**方法 A: git が使える場合（推奨）**

```bash
git clone --depth 1 https://github.com/tsukaharakazuki/td-ec-golden-path-analytics.git /tmp/td-ec-golden-path-analytics
```

**方法 B: git が使えない場合**

`MANIFEST.txt` を Raw URL で取得し、記載された各ファイルを `<Raw URL の基点><パス>` から同じ相対パスで一時フォルダに保存する。

取得後、次を読む: `$SKILL/references/hearing.md`、`$SKILL/references/data-discovery.md`、`$SKILL/references/methodology.md`、`$SKILL/workflow/golden_path/config/params.yml`。

## Step 2: 作業フォルダと接続先

### 2-1. 作業フォルダを決める（`my` 以外）

1. `pwd` で現在のフォルダを確認する。パスに `my` という名前のフォルダが含まれていたら、その中では作業しない（Treasure AI Studio では、セッションの既定の作業フォルダが `my` のことがある）。
2. `my` 以外のフォルダに作業フォルダを作る。既定は `my` と同じ階層（ワークスペース直下）に `golden-path/` を作り、`$WORK` とする。複数のブランド・顧客を扱う場合は `golden-path-<ブランド>/` のように分けてよい。チームで使う共有フォルダの名前や置き場所の決まりがあれば利用者に確認して従う。
   ```bash
   pwd                                    # 例: /workspace/my → my の中なので使わない
   mkdir -p /workspace/golden-path        # my 以外に作る（例）
   WORK=/workspace/golden-path
   ```
3. 以降の生成物はすべて `$WORK` の下に置く。利用者が添付したファイルが `my` にある場合は、読み取るのは構わないが、出力先は `$WORK` にする。

```text
$WORK/                                   ← my 以外の共有フォルダ
├─ MEMORY.md                             ← 作業記録（時系列・担当者をまたいで引き継ぐ）
├─ <プロジェクト名>/                      ← Workflow プロジェクト（既定 golden_path）
├─ _discovery/                           ← データ確認用 SQL（Step 4）
├─ golden_path_reports/<YYYYMMDD>/       ← 抽出 SQL・データ・bundle.json・ダッシュボード HTML
└─ .claude/skills/td-ec-golden-path-analytics/   ← 運用 Skill と config/install.yml（Step 8）
```

### 2-2. MEMORY.md を読む

- `$WORK/MEMORY.md` があれば最初に読む。最後のエントリの「状態」「未解決・要確認」「次にやること」から再開し、現在の状態を一言で伝える。回答済みのヒアリング項目は聞き直さない。
- 無ければ作る（作業記録の最初のエントリ）。担当者名を聞いて `--by` に入れる（引き継ぎ相手が分かるようにするため。分からなければ「Treasure AI Studio（<利用者名>）」など）。
  ```bash
  node $SKILL/scripts/gp-cli.mjs memory $WORK --by "<担当者>" --stage 準備 --status 進行中 \
    --summary "初期構築を開始。作業フォルダ $WORK を作成" --next "ヒアリング A から"
  ```

### 2-3. 接続先と既存インストール

- `tdx status` でプロファイル・サイト・アカウントを確認して提示する（承認後）。利用者が示した TD コンソールの URL のドメインと site が食い違う場合は `--profile` / `--site` を確認する。
- 既に `$WORK/.claude/skills/td-ec-golden-path-analytics/config/install.yml` がある場合は「再構築（ヒアリングをやり直す）／設定の一部変更／中止」を確認する。一部変更なら、既存の `params.yml` の値と MEMORY.md の経緯を見せて、変更するテーマだけ聞き直す（Step 3 の該当テーマ → Step 5 以降）。
- 以前のバージョンで `my` の中に構築済み（`my/.claude/skills/td-ec-golden-path-analytics/` や `my/golden_path/` がある）の場合は、`$WORK` へのコピーを提案し、了承を得て `install.yml`・Workflow プロジェクト・レポートをコピーする（`my` 側は消さずに残し、移したことを伝える）。移したことを MEMORY.md に記録する。TD 上の Workflow や出力テーブルは変わらない。

## Step 3: ヒアリング

`$SKILL/references/hearing.md` の **A〜I** を順に進める。回答は `params.yml` の対応キーにメモしていく。テーマの区切りごと（少なくとも中断するときと A〜I を終えたとき）に、確定した内容と「後で」になった項目を MEMORY.md に追記する（`--stage ヒアリング`）。

| テーマ | 内容 | 主な書き込み先 |
|---|---|---|
| A | 顧客名・出力 DB・Workflow プロジェクト名・店舗まで含めるか | `common` / install.yml |
| B | Webログ（td-js-sdk） | `source.weblog` |
| C | 購入完了（CV）の判定・注文ID・GA4 ecommerce | `cv` / `ecommerce` |
| D | ページ分類と商品ID | `pages` |
| E | 流入タッチ（自社ドメイン・utm の付け方・メール・広告・除外）とアトリビューション | `touch` / `attribution` / `email` / `ads` / channel_rules.sql |
| F | 会員データ | `source.member` / `source.id_map` |
| G | POS（店舗＋EC）と商品マスタ | `source.pos` / `source.product` |
| H | 分析の設定（RFM・ロイヤル定義・商品のまとめ方・スコアの重み） | `rfm` / `journey` / `golden_path` |
| I | 購入回数の推移（何回目まで、軸＝カテゴリ・ブランド・金額帯など、最終列のランク、1注文で複数カテゴリを買ったときの見せ方） | `frequency_sankey` |

- 「ない」と答えたデータは `enabled: false` にし、使えなくなる分析を一言伝える（会員・POS が無い場合、RFM とロイヤル顧客の分析、店舗購入の判定、再購入率の一部が使えない）。
- POS が無い場合は `frequency_sankey.enabled: false` にする（購入回数の推移は POS の明細から作る）。
- 会員ID が Webログに無く、ID 対応テーブルも無い場合は `common.id_stitching: cookie` とし、流入元は utm とリファラで判定することを伝える。

## Step 4: データ確認と設定値の提案（承認制・読み取り専用）

ヒアリングで分かった値を `params.yml`（Step 5 でコピーする前の下書きでよい）に書き、データ確認用の SQL を書き出して実行する。手順と結果の読み方は `$SKILL/references/data-discovery.md`。

```bash
node $SKILL/scripts/gp-cli.mjs discovery-sql --params <下書きの params.yml> --out <作業フォルダ>/_discovery
tdx query -f <作業フォルダ>/_discovery/<クエリ>.sql --json --limit 1000
```

実行前にクエリ一覧と目的を示して承認を得る。値が未確定のクエリは書き出されない（skip と表示される）。結果は件数・割合で要約し、次を **提案** として示して利用者に選んでもらう。

1. **購入完了の判定**（Q2）: Thanks URL の候補、注文ID の取り方（URL パラメータ / カラム / ecommerce.transaction_id）。ecommerce が取り込まれていれば、JSON のパス（`$.items` など）を実例の構造（値はマスク）で確認する。
2. **除外すべきリファラ**（Q3）: 購入直前に現れるリファラのホストのうち、セッション開始時にはほとんど現れないもの（決済サービス・3D セキュア・会員アプリなど）を `touch.exclude_referrer_regex` の候補として示す。アプリ内ブラウザなど UA で判定すべきものは `touch.exclude_hit_condition` の候補にする。
3. **チャネル分類**（Q4）: utm_source / utm_medium / utm_campaign の値の棚卸しから、`channel_rules.sql` の追加・変更案を示す（例: PMax のキャンペーン命名、メールの medium、LINE の source）。メールと広告の判定（`email.*_regex`、`ads.*_regex`）もここで確定する。
4. **戻る・進むによる再記録**（Q5）: 内部リファラなのに utm が付いたヒットの割合を示し、`touch.collapse_mode`（既定 `session`）を確認する。
5. **ページ分類**（Q6）: パスの上位パターンから `pages.*_regex` を提案し、商品IDが取れることを確認する。
6. **ID と結合**（Q7〜Q9）: 会員ID の付与率、Webログ・会員・POS の会員ID の形式の一致、Web の注文ID と POS の注文ID の一致率、Web の商品ID と POS の商品キーの一致率。一致しない場合は変換式（`source.pos.product_id_expr` など）を相談する。

tdx が使えない環境では、利用者にテーブル定義とサンプル（マスク済み）を貼ってもらう。

終わったら、採用した提案（CV 判定、除外リファラ、チャネル分類、ページ分類、ID の変換式）と、その根拠（件数・割合）を MEMORY.md に追記する（`--stage データ確認`）。生値・会員ID・クエリ結果そのものは書かない。

## Step 5: Workflow の生成と静的検査

1. `$SKILL/workflow/golden_path/` を作業フォルダの `<作業フォルダ>/<プロジェクト名>/` にコピーする（既定のプロジェクト名 `golden_path`。既に同名フォルダがあれば上書きしてよいか確認する）。
2. `config/params.yml` をヒアリングとデータ確認の結果で埋める。`queries/01_prep/channel_rules.sql` を Step 4 の提案どおりに編集する。`tdx.json` の `workflow_project` をプロジェクト名にする。
3. 静的検査を実行し、エラーが無くなるまで直す:
   ```bash
   node $SKILL/scripts/gp-cli.mjs check <作業フォルダ>/<プロジェクト名>
   ```
4. 主要な設定（データソース、CV 判定、除外リファラ、チャネル分類、粒度・世代数・遡り日数、RFM とロイヤル定義、スコアの重み）を一覧で見せ、最終確認を取る。
5. 確定した設定の要点と残った `<TO_BE_CONFIRMED>` を MEMORY.md に追記する（`--stage Workflow生成`）。

## Step 6: push と初回実行（承認制）

1. `tdx wf push <作業フォルダ>/<プロジェクト名> --dry-run` で差分と影響を見せる。出力先 DB（`common.database`）が無い場合は Workflow 内の `td_ddl>` が作成することを伝える。
2. 利用者が明示的に了承したら `tdx wf push <作業フォルダ>/<プロジェクト名>` を実行する。
3. 初回実行の前に、所要時間の目安（Webログの件数 × 期間で変わる。数十分かかることがある）と、作成される `gp_*` テーブル（README の「出力テーブル」）を伝え、了承を得て `tdx wf run <プロジェクト名>.golden_path` を実行する。
4. `tdx wf sessions <プロジェクト名>.golden_path --limit 1 --format json` で状態を確認する（数分おき）。失敗したら `tdx wf attempt <attempt-id> tasks` と `tdx wf attempt <attempt-id> logs +<失敗タスク>` で原因を調べ、設定の修正案を示す。SQL エラーの多くは params.yml の式（`*_expr`）やカラム名の誤り。
5. 成功したら、`gp_dash_kpi` を `tdx query` で取得し、データの状態（会員ID の付与率、集約されたタッチ数、除外したリファラのヒット数、商品が分かる CV の割合など）を確認する。想定と大きく違う値があれば設定を見直す。
6. push（承認者・日時）、実行の session / attempt と結果、データの状態の要点を MEMORY.md に追記する（`--stage push・初回実行`）。失敗して止める場合も、原因と次の手を書いて止める。

## Step 7: ダッシュボードの作成

運用 Skill（`$SKILL/SKILL.md`）の「ダッシュボード更新」の手順 2〜5 と同じ:

```bash
node $SKILL/scripts/gp-cli.mjs export-sql --db <出力DB> --out <レポートフォルダ>/<日付>/sql
# 各 SQL を実行（20 本）
tdx query -f <レポートフォルダ>/<日付>/sql/<key>.sql --json --limit 100000 --output <レポートフォルダ>/<日付>/data/<key>.json
node $SKILL/scripts/gp-cli.mjs bundle --in <レポートフォルダ>/<日付>/data --params <作業フォルダ>/<プロジェクト名>/config/params.yml --client "<顧客名>" --project <プロジェクト名> --out <レポートフォルダ>/<日付>/bundle.json
node $SKILL/scripts/gp-cli.mjs dashboard --bundle <レポートフォルダ>/<日付>/bundle.json --out <レポートフォルダ>/<日付>/golden-path-dashboard.html --by "<担当者>"
```

レポートフォルダの既定は `$WORK/golden_path_reports/`（`my` の中にしない）。`dashboard` は `$WORK/MEMORY.md` に作成した旨を自動で 1 行追記する。HTML は 1 ファイルで完結し、外部と通信しない。ビューアー（GitHub Pages）に `bundle.json` を読み込んでも同じ画面を見られる。

## Step 8: 運用 Skill の配置と完了報告

1. `$SKILL` フォルダ全体（`workflow/` テンプレートを含む）を `$WORK/.claude/skills/td-ec-golden-path-analytics/` にコピーする（`my/.claude/skills/` には置かない）。
2. `$WORK/.claude/skills/td-ec-golden-path-analytics/config/install.yml` を作る（形式は運用 Skill の「install.yml」）。顧客名、プロジェクト名、作業フォルダ、Workflow フォルダ、出力 DB、tdx のプロファイル、レポートフォルダ、作業記録、セットアップ日、取得元のコミット、未確認事項を書く。
3. MEMORY.md に完了を追記する（`--stage 初期構築完了 --status 完了`）。作ったもの、未確認事項とその確認先、次にやること（例: 定期実行にするか、未確認事項の確認）を書く。
4. 次の順で簡潔に報告する。
   1. **作ったもの** — 作業フォルダ（`$WORK`、my 以外の共有フォルダ）、Workflow プロジェクト、出力 DB とテーブル、ダッシュボードのファイル、MEMORY.md
   2. **確定した設定** — データソース、CV 判定、除外リファラ、チャネル分類、アトリビューション、RFM・ロイヤル定義、スコアの重み
   3. **データの状態** — Step 6-5 の要点と、そこから読み取れる注意点
   4. **未確認事項** — `<TO_BE_CONFIRMED>` と、その影響
   5. **使い方** — 次のように頼めば運用 Skill が動くこと。他のメンバーも `$WORK` を開けば同じ Skill と MEMORY.md を使えること

```text
ゴールデンパス分析を最新にして          … Workflow を実行してダッシュボードを作り直す
ダッシュボードだけ作り直して            … 実行済みの結果からダッシュボードを作る
〇〇キャンペーンの広告は購買にどう効いてる？ … 中間テーブルを使って追加分析
メール「△△」で見られた商品と購入を教えて
ゴールデンパスの設定を変更したい          … 設定の一部変更
```
