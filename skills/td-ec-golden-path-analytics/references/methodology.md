# 集計ロジック

Workflow `golden_path` が作るテーブルと、その考え方。テーブルはすべて `<common.database>.gp_*`、エンジンは Trino（presto）。

```text
01_prep   元データの正規化
  gp_channel_rules, gp_members, gp_order_lines → gp_orders, gp_product_master, gp_id_map
  gp_hits → gp_touch_dim → gp_sessions / gp_touchpoints / gp_conversions → gp_cv_items → gp_product_dim
02_marts  中間テーブル
  RFM            gp_rfm_customer → gp_rfm_matrix, gp_rfm_segments
  アトリビューション gp_attribution_credits → gp_attribution_summary, gp_attribution_channel
  経路           gp_cv_journey → gp_cv_journey_items, gp_open_journeys, gp_path_length, gp_top_paths
  購買サイクル     gp_lifecycle → gp_funnel_summary
  購入回数の推移   gp_freq_orders → gp_freq_final → gp_freq_links, gp_freq_nodes, gp_freq_outcome, gp_freq_combos
03_golden ゴールデンパス分析
  Q1 gp_loyal_product_paths, gp_loyal_behavior_stats
  Q2 gp_ad_contribution, gp_ad_product
  Q3 gp_email_view_purchase → gp_email_influence, gp_email_product
  スコア gp_golden_path_candidates → gp_golden_paths
04_dash   gp_dash_kpi
```

## 1. 人物とセッション

- **人物キー（person_key）**: `id_stitching: member` なら、cookie に対応する会員ID（Webログで最も多く記録された会員ID、無ければ ID 対応テーブル）。会員ID が無い cookie は `c:<cookie>`。ログイン前の行動も、その cookie が後でログインすれば会員に紐づく。
- **セッション**: 同じ人物のヒットの間隔が `touch.session_timeout_minutes`（30 分）を超えたら新しいセッション。

## 2. 流入タッチ

ヒットごとに次の順で判定する（上から最初に当てはまったもの）。

| 判定 | タッチ | source / medium |
|---|---|---|
| `touch.exclude_hit_condition` に一致 | なし | |
| utm_source / utm_medium がある（`exclude_utm_source_regex` に一致する source は除く） | utm | utm の値（小文字化） |
| gclid / yclid / msclkid がある | click_id | google・yahoo・bing / cpc |
| リファラが除外ホスト（`exclude_referrer_regex`） | なし | |
| リファラが外部ホスト | referrer | リファラのホスト / organic（検索エンジン）・referral |
| セッションの先頭 | direct | (direct) / (none) |
| それ以外（内部遷移） | なし | |

チャネルは `gp_channel_rules`（`channel_rules.sql`）で source / medium / campaign から決める。`touch_key` は `attribution.grain` の粒度（例: `google / cpc / pmax_all_products`）。

**除外リファラ**: 購入直前に決済サービス（PayPay、楽天ペイ、3D セキュアなど）や会員アプリを経由すると、Thanks ページのリファラが外部ホストになり、ラストクリックが決済サービスに奪われる。データ確認の q3 で候補を出し、除外する。

**集約（戻る・進む対策）**: td-js-sdk はブラウザの戻る・進むでも pageview を送るため、utm 付きの着地 URL が再記録されることがある（例: `pmax → 内部 → 内部 → pmax`）。人物ごとにタッチを時刻順に並べ、直前のタッチと `touch_key` が同じ場合は 1 世代にまとめる（`gp_touchpoints`）。`collapse_mode: session` は同一セッション内だけ、`always` はセッションをまたいでも、`none` はまとめない。粒度を `channel` にすると、同じチャネル内のキャンペーン違いもまとまる。

## 3. コンバージョン（EC 購入）

- 購入完了ヒット（`cv.condition`）。注文ID（`cv.order_id_expr` → ecommerce.transaction_id）があれば注文ID で重複排除、無ければ同一人物 `cv.dedupe_minutes` 分以内を 1 件にまとめる。
- 売上: ecommerce.value → POS の注文金額（注文ID が一致する場合）。
- 購入商品（`gp_cv_items`）: ecommerce.items → POS 明細。カテゴリ・ブランドは商品マスタを優先。
- 新規購入: 会員なら POS にそれより前の購入が無い。非会員は期間内の初回 CV。

## 4. アトリビューション（`gp_attribution_credits`）

CV ごとに、CV 時刻から `attribution.lookback_days` 日前までの集約後のタッチを、新しい順に最大 `attribution.max_generations`（12）世代取る。`reset_after_conversion: true` なら前回の CV より前のタッチは含めない。古い順に generation = 1..n。

| モデル | 配分 |
|---|---|
| ファーストクリック | generation 1 に 1 |
| ラストクリック | generation n に 1 |
| 線形 | 各 1/n |
| 逓減（Time Decay） | 2^(−CV までの日数 / 半減期) を CV 内で合計 1 に正規化 |
| U 字（Position Based） | 最初 u_first・最後 u_last・中間で残りを均等。n=1 は 1、n=2 は 0.5 ずつ |

売上の貢献は「配分 × その CV の売上」。遡り期間にタッチが無い CV は `(no touch)` に 1。
**アシスト** = 最後以外の位置で経路に含まれた CV 数。

## 5. RFM（`gp_rfm_customer` / `gp_rfm_matrix`）

POS（`rfm.scope: all` は店舗＋EC、`ec` は EC のみ）の会員ごとに R（最終購入からの日数）、F（注文数）、M（購入金額）を 5 段階にする。

- R・M: 20% 刻みの分位点の境界値で判定（同じ値は同じスコア）。R は最近ほど 5。
- F: 同じ値が多いため、既定は閾値（`f_thresholds: [2, 3, 5, 8]` → 1 回=1、2 回=2、3〜4 回=3、5〜7 回=4、8 回以上=5）。`f_method: quantile` で分位にもできる。
- 5 × 5 × 5 = 125 ブロック（`gp_rfm_matrix` は 0 人のブロックも含む）。
- セグメント: チャンピオン（R≥4・F≥4）、ロイヤル（R=3・F≥4）、育成候補（R≥4・F=2〜3）、新規（R≥4・F=1）、要注意（R=3）、離反リスク（R≤2・F≥3）、休眠（その他）。
- ロイヤル顧客: `rfm.loyal_condition`（既定 R≥4 かつ F≥4）。CV の分析では **現在の** RFM を使う（購入時点の RFM ではない）。

## 6. 経路とサイト内行動（`gp_cv_journey`）

- **channel_path**: 世代のチャネルを古い順に並べ、同じチャネルの連続を 1 つにまとめたもの。
- **path_pattern**: channel_path の直近 `golden_path.path_steps`（4）ステップ。それより長い場合は先頭に `…`。ゴールデンパスの「流入経路」の単位。
- **behavior_signature**: 購入したセッションの、購入完了より前のページ種別の並び。同じ種別の連続は 1 ステップ（×2 / ×3+）。カート・購入手続き（`golden_path.behavior_exclude_regex`）は、購入直前に必ず通るため含めない。先頭 `behavior_steps`（6）ステップ。
- 購入までのセッション数・商品詳細の閲覧数・検索の利用は、最初のタッチから購入までのセッションで数える。
- **再購入**: CV の 1 日後〜`journey.repurchase_window_days` 日以内に、Web の CV または POS の購入（店舗含む）がある。CV からその日数が経過していない CV は再購入率の計算から除く（`repeat_eligible`）。

## 7. 購買サイクル（`gp_lifecycle` / `gp_funnel_summary`）

期間内に訪問した人物ごとに、流入（最初のタッチのチャネル）→ 回遊（`browse_min_pv` PV 以上か商品詳細を閲覧）→ 会員（会員ID で識別）／期間内の会員登録 → 購買（Web の CV ＋ 会員の POS 購入）→ 再訪問（初回購買の 1 時間後〜`revisit_window_days` 日）→ 再購入。
各段階は「流入した人」に対する割合で見る（段階は厳密な入れ子ではない。例: ゲスト購入は会員でなくても購買に入る）。

## 7.5 購入回数の推移（フリークエンシー・サンキー、`gp_freq_*`）

**対象**: POS の会員の注文（`amount > 0`、`frequency_sankey.scope`）を時刻順に並べ、1 回目を F1 とする。期間の先頭で既に購入していた既存顧客を F1 と数えないよう、POS 期間の最初の `new_customer_gap_days` 日に購入が無い会員だけを対象にする。F2 以降は期間内の購入（期間が長いほど後半の回まで届く）。

**値（ノード）**: 注文ごとに、軸（`dimensions`）の値を決める。
- `category` / `brand` / `custom` … 明細から（商品マスタ → POS 明細の順）。購入者数の多い上位 `top_nodes` 件以外と不明は「その他」
- `amount_band` … 1注文の合計金額を `amount_bands` で区切る
- `channel` … EC / 店舗

**1注文に複数の値があるとき**（例: アウターとトップスを同時に購入）。3 通りを同時に集計し（`mode`）、ダッシュボードで切り替える。

| mode | 決め方 | weight | 向いている問い |
|---|---|---|---|
| primary | 金額が最大の値（同額なら不明でない方） | 1 | 主に何を買った人が、次に何を買うか。人数が保たれる（既定） |
| mixed | 2 つ以上なら「複数カテゴリ」「複数ブランド」 | 1 | まとめ買い・併買がどの回で起き、その後どこへ流れるか |
| split | 値ごとの金額比率で按分 | 合計 1 | すべての値の流れを出したい。人数は「人相当」 |

F(k) → F(k+1) の帯の weight は前後の注文の weight の積（split では 0.8 × 0.5 = 0.4 人相当など）。どの mode でも各列の合計は人数と一致する。
1 人を各値で重複して数える方法は、列の合計が人数を超え、帯の太さが人数を表さなくなるので採らない。
どの mode でも、注文が複数の値を含んでいたか（`is_multi`）と組み合わせ（`combo`）を残し、ノードごとの「複数購入の比率」と組み合わせの上位（`gp_freq_combos`）で補う。

**離脱**: F(k) が最後の購入だった人は、F(k+1) の列の「(離脱)」へ流す（ダッシュボードの「初回購入者全員」で表示）。

**最終列**（`final_column`）: F`max_steps` まで購入した人だけ。`amount_rank` は F`max_steps` 時点の累計購買金額を `rank_thresholds` で区切ったランク、`rfm_segment` は現在の RFM セグメント。`gp_freq_outcome` は「F(k) でその値を買った人が、最終的にどのランクになったか」で、入口商品ごとの上位ランク率に使う。

**注意**: 期間の終わりに近い初回購入者は、まだ 2 回目を買う時間が無い。F(k) への到達率は、初回購入の時期をそろえた比較（例: playbook の `freq_cohort`）で見る。

## 8. 3 つの問い

### Q1 ロイヤル顧客の買い方（`gp_loyal_product_paths` / `gp_loyal_behavior_stats`）
会員の CV を、購入した商品グループ（`golden_path.product_level`）ごとに、ロイヤル顧客とそれ以外に分け、流入経路・サイト内行動・最初のチャネル・着地ページの各パターンの割合を比べる。
特徴度 = (ロイヤル内の割合) ÷ (それ以外の割合)（0.5 を足して平滑化）。1 より大きいほどロイヤル顧客に特徴的。

### Q2 広告の購買貢献（`gp_ad_contribution` / `gp_ad_product`）
`ads.paid_medium_regex` または `ads.paid_channel_regex` に当たるタッチについて、5 モデルの貢献 CV・売上、アシスト、経路内の役割（最初／中間／最後／単独）、CV までの日数、関わった CV の新規率・ロイヤル率・再購入率・客単価。商品グループへの貢献は、CV の配分を購入商品の金額比で按分する。

### Q3 メール → 商品閲覧 → 同一商品の購入（`gp_email_*`）
入口のタッチがメール（`email.medium_regex` / `source_regex`）のセッションで閲覧した商品詳細を、メール × 人物 × 商品ごとに 1 行にし、最初の閲覧から `email.same_product_window_days` 日以内に、同じ人が同じ商品を購入したか（Web の CV の購入商品、または会員の POS 明細＝店舗を含む）を判定する。Web の CV と POS の EC 注文が同じ注文の場合は 1 件として数える。

## 9. ゴールデンパスのスコア（`gp_golden_path_candidates` / `gp_golden_paths`）

CV ごとの（流入経路 path_pattern, サイト内行動 behavior_signature, 主な商品グループ）を、次の 5 つの単位で集計して候補にする。

| 種別 | 単位 |
|---|---|
| full | 経路 × 行動 × 商品 |
| acquisition_product | 経路 × 商品 |
| onsite_product | 行動 × 商品 |
| acquisition | 経路 |
| onsite | 行動 |

各候補について 5 つの要素を、全体平均との比（リフト）で測る。件数の少ない候補が偶然高く出ないよう、`prior_strength`（k）件ぶんの全体平均を足して平滑化する。

| 要素 | 値 | リフト |
|---|---|---|
| CVR | 経路の CVR = その経路で CV した数 ÷（CV した数 ＋ 未 CV の経路数 `gp_open_journeys`）／ 行動の CVR = そのパターンのセッションの CV 率 | 経路と行動の両方がある種別は 2 つのリフトの幾何平均 |
| ロイヤル率 | 購入者に占めるロイヤル顧客の割合（会員のみ） | (ロイヤル CV + k × 全体率) ÷ (会員 CV + k) ÷ 全体率 |
| 再購入率 | 再購入した割合（判定可能な CV のみ） | 同様 |
| 客単価 | 1 CV あたり売上 | (売上 + k × 全体客単価) ÷ (CV + k) ÷ 全体客単価 |
| CV 数 | 件数 | 2 × ln(1+CV) ÷ ln(1+その種別の最大 CV) − 1 |

各リフトは `ln(リフト) ÷ ln(lift_cap)` を −1〜1 に丸めて要素スコアにし（リフト 3 倍で 1、1/3 で −1）、重み付き平均して

```text
スコア = 50 + 50 × Σ(重み × 要素スコア) ÷ Σ重み
```

とする。50 が全体平均並み、100 がすべての要素で上限。データが無い要素（会員データが無いときのロイヤル率など）は 0（平均並み）として扱う。

採用（`gp_golden_paths`）: CV が `min_support` 以上の候補から、種別ごとにスコア順に `top_n` 件。同じ入口（経路の最初のチャネル、行動の場合は最初のページ種別）からは `max_per_entry` 件までにして、似たパターンばかりにならないようにする。`strengths` はスコアへの寄与が大きい上位 2 要素。

### 解釈の注意
- ゴールデンパスは相関であって因果ではない。もともと購買意欲の高い人が通る経路が高く出る（例: メールを開く既存顧客）。施策に使うときは、新規・既存を分けて見る、A/B テストで確かめる。
- ロイヤル率は現在の RFM を使うため、「その経路で買ったからロイヤルになった」とは限らない。
- 集計期間の後半の CV は再購入の判定期間が足りないため、再購入率の計算から除いている。
