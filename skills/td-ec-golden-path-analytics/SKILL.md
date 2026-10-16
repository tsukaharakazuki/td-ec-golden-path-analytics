---
name: td-ec-golden-path-analytics
description: Treasure Data 上の EC ゴールデンパス分析（流入→回遊→会員登録→購買→再訪問）を運用する。集計 Workflow（golden_path）を tdx で実行して最新化し、中間テーブル（RFM 125 ブロック、5 モデルのアトリビューション、購買サイクル、ゴールデンパスのスコア）からダッシュボード HTML を作る。ロイヤル顧客の商品別の流入経路・サイト内行動、特定の広告の購買貢献、特定のメールで閲覧された商品と同一商品の購入などの追加分析と、設定の変更も行う。生成物は「my」以外の共有の作業フォルダに置き、作業の経緯を MEMORY.md に時系列で残す。「ゴールデンパス分析を最新にして」「ゴールデンパスのWFを回して」「ダッシュボードを更新」「この広告は購買にどう効いてる」「このメールで見られた商品は買われた？」「ロイヤル顧客はどう買っている？」「アトリビューションをモデル別に」「RFMマトリクスを見せて」「ゴールデンパスの設定を変更」で発動する。
---

# EC ゴールデンパス分析（運用）

この Skill は初期構築（リポジトリ直下の `SKILL.md`）が済んだ作業フォルダで使う。以下、この Skill のフォルダを `$SKILL`、作業フォルダ（`install.yml` の `work_dir`。Treasure AI Studio の「my」以外の共有フォルダ）を `$WORK` と書く。`install.yml` の相対パスは `$WORK` からの相対。

## 始めるとき

1. `$SKILL/config/install.yml` を読む。無い場合は初期構築がまだなので、リポジトリ `https://github.com/tsukaharakazuki/td-ec-golden-path-analytics` の `SKILL.md` に従って構築を始めるよう案内する。
2. `$WORK` を決める（`work_dir`。無ければ `$SKILL` の 3 つ上 ＝ `.claude` を含むフォルダ）。`$WORK` のパスに `my` という名前のフォルダが含まれていたら（以前のバージョンで `my` に構築した場合）、作業を始める前に `my` 以外の共有フォルダ（例: `my` と同じ階層の `golden-path/`）へのコピーを提案し、了承を得て `.claude/skills/`・Workflow プロジェクト・レポート・MEMORY.md をコピーして `install.yml` の `work_dir` を直す（`my` 側は消さない）。TD 上の Workflow と出力テーブルはそのまま使える。
3. `$WORK/MEMORY.md` を読み、最後のエントリの「状態」「未解決・要確認」「次にやること」を確認する。依頼と関係があれば（中断した作業の続き、未確認事項が結果に効くなど）一言添える。無ければ「作業記録」の手順で作る。
4. セッションの現在のフォルダが `my` でも、ファイルの読み書きは `$WORK` の下で行う。

## install.yml

```yaml
client: ミナト衣料                # ダッシュボードの見出し
project: golden_path              # Treasure Workflow のプロジェクト名
workflow: golden_path             # ワークフロー名（.dig のファイル名）
work_dir: /workspace/golden-path  # 作業フォルダ（my 以外の共有フォルダ）
workflow_dir: ./golden_path       # 作業フォルダ内の Workflow プロジェクト
database: golden_path_mart        # 出力 DB（params.yml の common.database と同じ）
tdx_profile: ""                   # 空ならデフォルト
reports_dir: ./golden_path_reports
memory: ./MEMORY.md               # 作業記録（時系列）
setup_date: 2026-10-12
source_commit: <取得元のコミットまたは取得日時>
unresolved:                       # 未確認事項
  - ...
```

## 守ること

1. **Workflow の実行は、利用者が最新化を頼んだときだけ。** 「最新にして」「WF を回して」などの依頼が実行の了承にあたる。それ以外（質問・追加分析）で勝手に実行しない。
2. **push は設定変更のときだけ、差分を見せて了承を得てから。** `tdx wf push --dry-run` で差分を見せる。`-y` は付けない。
3. **追加分析の SQL は読み取り専用。** `CREATE` / `INSERT` / `DELETE` / `DROP` を含む SQL は実行しない。中間テーブル（`<database>.gp_*`）を使い、元のログを直接読むときは `TD_INTERVAL` で期間を絞る。
4. **個人を特定できる値を出さない。** 会員ID・cookie を一覧で出さない。結果は集計値で示す。
5. **数字は根拠とともに。** 期間、モデル、粒度、最小件数などの前提を添える。少数（目安 30 件未満）の結果は参考値と明記する。
6. **生成物を「my」フォルダに置かない。** `my` は本人しかアクセスできず、他のメンバーに共有できない。レポート・ダッシュボード・追加分析の SQL と結果ファイル・設定ファイルは `$WORK` の下に置く。`tdx query --output` の出力先も同じ。`gp-cli.mjs` も `my` の中への書き出しをエラーにする。
7. **作業を MEMORY.md に記録する。** 運用は担当者をまたいで続く。各モードを終えたとき・中断するときに `$WORK/MEMORY.md` へ時系列で追記する（下の「作業記録」）。

## 作業記録（MEMORY.md）

- 追記は古い順（下に足す）。過去のエントリは書き換えず、訂正は新しいエントリで行う。担当者はその時の利用者の名前（分からなければ「Treasure AI Studio（<利用者名>）」、定期実行なら「定期実行」）。
  ```bash
  node $SKILL/scripts/gp-cli.mjs memory $WORK --by "<担当者>" --stage "<段階>" --status 完了 \
    --summary "<1行の要約>" --done $'<実施したこと>' --decided $'<決定・確認済み>' --open $'<未解決・要確認（誰に聞くか）>' --next $'<次にやること>'
  ```
- 書くタイミングと内容:

| モード | `--stage` | 書くこと |
|---|---|---|
| A. 最新化 | 最新化 | session / attempt、成否、所要時間 |
| B. ダッシュボード更新 | ダッシュボード作成 | `dashboard --by` が自動で 1 行追記する。前回からの大きな変化やデータの状態で気になる点があれば、別に 1 エントリ足す |
| C. 追加分析 | 追加分析 | 問い、対象（touch_key など）・期間・モデル、結論の要点、SQL を保存した場所 |
| D. 設定変更 | 設定変更 | 変更前→変更後の値、理由、push の承認者と日時 |
| E. 調査 | 調査 | 原因、対応、残った課題 |

- API キー・トークン・Webhook URL・会員ID などの生値・クエリ結果の生データは書かない。

## モードの判定

| 依頼 | モード |
|---|---|
| 最新にして / WF を回して / 今日の数字で | A. 最新化（実行 → ダッシュボード） |
| ダッシュボードだけ / HTML を作り直して | B. ダッシュボード更新 |
| 特定の広告・メール・商品・顧客層について知りたい | C. 追加分析 |
| テーブルや判定ルール、重みを変えたい | D. 設定変更 |
| 失敗した / 数字がおかしい | E. 調査 |

## A. 最新化

1. `tdx wf run <project>.<workflow>` を実行し、返ってきた session / attempt を控える。
2. 数分おきに `tdx wf sessions <project>.<workflow> --limit 1 --format json` で状態を見る。実行中は「実行中（開始から n 分）」と短く伝える。長時間かかる場合は、終わったら続きを頼むよう伝えてよい。
3. 失敗したら E へ。成功したら session / attempt と所要時間を MEMORY.md に追記して B へ進む。

## B. ダッシュボード更新

日付フォルダ `$WORK/<reports_dir>/<YYYYMMDD>/` を作り、次を実行する（`my` の中に作らない）。

1. 抽出 SQL を書き出す:
   `node $SKILL/scripts/gp-cli.mjs export-sql --db <database> --out <日付フォルダ>/sql`
2. 20 本の SQL をそれぞれ実行する:
   `tdx query -f <日付フォルダ>/sql/<key>.sql --json --limit 100000 --output <日付フォルダ>/data/<key>.json`
3. バンドルを作る（検証込み）:
   `node $SKILL/scripts/gp-cli.mjs bundle --in <日付フォルダ>/data --params <workflow_dir>/config/params.yml --client "<client>" --project <project> --attempt <attempt-id> --out <日付フォルダ>/bundle.json`
4. ダッシュボードを作る:
   `node $SKILL/scripts/gp-cli.mjs dashboard --bundle <日付フォルダ>/bundle.json --out <日付フォルダ>/golden-path-dashboard.html --by "<担当者>"`（`$WORK/MEMORY.md` に自動で 1 行追記される）
5. HTML を利用者に渡し（ファイルを送る / 開く）、次を 5〜8 行で要約する:
   - 期間、セッション、CV、売上、前回からの変化（前回の `bundle.json` があれば `kpi` を比較）
   - 各種別の 1 位のゴールデンパスと、その強み（`strengths`）。前回から入れ替わったものがあれば挙げる
   - データの状態で気になる点（会員ID の付与率の低下、タッチが無い CV の増加、ページ種別「その他」の増加など）

`bundle.json` は GitHub Pages のビューアー（`https://tsukaharakazuki.github.io/td-ec-golden-path-analytics/`）でも開ける。HTML・JSON ともブラウザ内だけで動き、外部へ送信しない。

## C. 追加分析

`$SKILL/references/analysis-playbook.md` に、よくある問いと中間テーブルを使った SQL がある。手順:

1. 問いを、対象（広告の touch_key、メールの email_key、商品グループ、RFM セグメントなど）・期間・評価モデルに落とす。対象の名前があいまいなら `gp_touch_dim` や `gp_attribution_summary` を検索して候補を示す。
2. playbook の SQL を埋めて実行する（`--limit` を付ける）。
3. 結果を表や短い文章で示し、前提（モデル、遡り日数、粒度、件数）を添える。ダッシュボードのどの画面で同じものを見られるかも伝える。
4. 使った SQL と結果を残す場合は `$WORK/golden_path_reports/analysis/<YYYYMMDD>_<テーマ>/` に置き、問いと結論の要点を MEMORY.md に追記する。

中心になる問いと、主に使うテーブル:

| 問い | テーブル |
|---|---|
| ロイヤル顧客は、買っている商品ごとに、どんな流入経路・サイト内行動をしているか | `gp_loyal_product_paths`, `gp_loyal_behavior_stats`, `gp_cv_journey`, `gp_cv_journey_items` |
| 特定の広告が、実際の購買にどう貢献しているか | `gp_ad_contribution`, `gp_ad_product`, `gp_attribution_credits`, `gp_cv_journey` |
| 特定のメールが、どの商品ページを閲覧させ、同じ商品の購入につながったか | `gp_email_influence`, `gp_email_product`, `gp_email_view_purchase` |
| どのパターンがゴールデンパスか、なぜか | `gp_golden_paths`, `gp_golden_path_candidates` |
| 初回から N 回目までに買うもの（カテゴリ・ブランド・金額帯）がどう移り、どのランクに育ったか | `gp_freq_links`, `gp_freq_nodes`, `gp_freq_outcome`, `gp_freq_combos`, `gp_freq_orders` |

集計ロジックの説明は `$SKILL/references/methodology.md`。

## D. 設定変更

1. 変更したい内容を聞き、`<workflow_dir>/config/params.yml`（またはチャネル分類なら `queries/01_prep/channel_rules.sql`）の該当箇所と現在の値を示す。ヒアリング項目は `$SKILL/references/hearing.md`、値の根拠が必要なら `$SKILL/references/data-discovery.md` のクエリを承認を得て実行する。
2. 変更して `node $SKILL/scripts/gp-cli.mjs check <workflow_dir>` を通す。
3. `tdx wf push <workflow_dir> --dry-run` で差分を見せ、了承を得て push する。
4. 必要なら A（実行 → ダッシュボード）へ。
5. `install.yml` の `unresolved` を更新し、変更前→変更後・理由・承認を MEMORY.md に追記する。

## E. 調査

1. `tdx wf sessions <project>.<workflow> --limit 3 --format json` → `tdx wf attempt <attempt-id> tasks` で失敗したタスクを特定し、`tdx wf attempt <attempt-id> logs +<task>` でエラーを読む。
2. よくある原因:
   - カラムが無い・型が違う → params.yml の `*_expr` / `*_col`
   - 正規表現の誤り → `*_regex`（Trino は Java 正規表現。シングルクォートは使えない）
   - タイムアウト・メモリ超過 → `common.weblog_lookback_days` を短くする、`source.weblog.filter_condition` でボットや対象外ホストを除く
   - 0 件 → `TD_INTERVAL` の期間、`cv.condition`、`touch.internal_host_regex`
3. 数字がおかしいときは `gp_dash_kpi` の品質指標と、`references/data-discovery.md` のクエリで原因を切り分ける。
4. 修正案を示し、了承を得て D の手順で反映する。原因と対応を MEMORY.md に追記する。
