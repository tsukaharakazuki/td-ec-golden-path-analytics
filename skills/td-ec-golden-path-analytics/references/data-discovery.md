# データ確認（読み取り専用）

初期構築の Step 4 と、設定変更・調査で使う。クエリは `$SKILL/discovery/` にあり、`params.yml` の値で埋めて書き出す。
値が未確定（`<TO_BE_CONFIRMED>`）のクエリは書き出されずに「skip」と表示されるので、先にヒアリングでテーブル名などを埋める。

```bash
node $SKILL/scripts/gp-cli.mjs discovery-sql --params <workflow_dir>/config/params.yml --out <作業フォルダ>/_discovery
node $SKILL/scripts/gp-cli.mjs discovery-sql --params ... --out ... --only q2,q3   # 一部だけ
tdx query -f <作業フォルダ>/_discovery/q3_pre_cv_referrers.sql --json --limit 1000
```

- 実行前に、実行するクエリの一覧と目的を示して承認を得る。
- どのクエリも `TD_INTERVAL` で期間を絞り、`LIMIT` を付けてある。期間を広げる場合は利用者に確認する。
- 結果に会員ID・メールアドレスなどの生値は出ない作りになっている。変更して生値を出さないこと。
- 結果は件数・割合で要約し、「提案」として示して利用者に選んでもらう。

| ID | 目的 | 前提となる設定 | 決めるもの |
|---|---|---|---|
| q1 | Webログの概要（ホスト、会員ID・utm・ecommerce の付与率） | B | `source.weblog.filter_condition`、会員ID・ecommerce の有無 |
| q2 | 購入完了ページの候補 | B | `cv.condition`、`cv.order_id_expr` |
| q2b | ecommerce JSON のキー構造 | B, C3 | `ecommerce.*_path` |
| q3 | 購入直前に現れる外部リファラ | B, C, E1 | `touch.exclude_referrer_regex` |
| q4 | utm の値の棚卸し | B | `channel_rules.sql`、`email.*_regex`、`ads.*_regex` |
| q5 | 戻る・進むによる utm の再記録 | B, E1 | `touch.collapse_mode` |
| q6 | パスの上位パターンとページ分類 | B, D | `pages.*_regex` |
| q7 | 会員ID の形式と一致率 | B, F, G | `member_id_expr` の変換、`id_stitching` |
| q8 | Web と POS の注文ID の一致率 | C, G | `source.pos.order_id_matches_web` |
| q9 | Web の商品ID と POS の商品キーの一致率 | D, G | `pages.product_id_regex`、`source.pos.product_id_expr` |

## 読み方と提案の仕方

### q1 Webログの概要
- 複数ホストが混ざっていれば、対象ホストを `filter_condition` に入れるか確認する（例: `regexp_like(td_url, '^https://www\.example\.com/')`）。
- `member_id_rate` が 0 なら会員ID は送られていない。cookie 単位（`id_stitching: cookie`）か、ID 対応テーブル（F6）を検討する。
- `ecommerce_rate` が 0 なら ecommerce は取り込まれていない（`ecommerce.column_expr` は `CAST(NULL AS VARCHAR)` のまま）。

### q2 / q2b 購入完了と ecommerce
- `order_param_rate` が高いパスが購入完了ページ。そのパスで `cv.condition` を作り、`matches_current_condition` が 1 になることを確認する。
- 注文ID が URL にあれば `url_extract_parameter(td_url, '<パラメータ名>')`、カラムにあればそのカラム。
- q2b の `item_keys` に `item_id` / `item_category` / `price` / `quantity` があるか確認し、名前が違えば `ecommerce.item_*_path` を合わせる。`items` が別の場所（例: `$.ecommerce.items`）にあれば `items_path` を直す。

### q3 購入直前の外部リファラ（除外の提案）
購入直前 3 ヒット以内に現れる外部リファラのうち、次に当てはまるホストを除外候補として示す。
- `pre_cv_hits / all_ext_hits` が 1 に近い（そのホストからの遷移がほぼ購入直前にしか起きない）
- `pre_cv_share` が `all_share` より大きい
- ホスト名が決済（pay / payment / checkout / 3dsecure / acs / veritrans / gmo-pg / sbpayment など）、ID 連携ログイン、会員アプリ（自社アプリのディープリンクなど）に見える

`already_excluded = 1` は既定の除外パターンに一致済み。提案は表で示し、利用者が選んだホストを `touch.exclude_referrer_regex` に追加する。
アプリ内ブラウザ（UA に自社アプリ名が入るなど）は、リファラではなく `touch.exclude_hit_condition` で除く（例: `regexp_like(td_user_agent, 'MixApp')`）。

### q4 utm の棚卸し（チャネル分類）
- `channel_rules.sql` の既定ルールで想定どおりに分類されるか、上位の組み合わせを見て確認する。
- 例: PMax が `utm_medium=cpc` でキャンペーン名に `pmax` が入る → 既定の PMax ルールに当たる。命名が違えば `campaign_regex` を直す。
- メールの medium / source、LINE、SNS 広告、アフィリエイトの値を `email.*_regex` / `ads.*_regex` / ルールに反映する。
- 大文字小文字・表記ゆれ（`Email` / `e-mail` / `mail`）は正規表現でまとめる。

### q5 戻る・進む
- `internal_referrer_rate` や `repeated_within_30min_rate` が数 % 以上あれば、utm 付き URL の再記録が起きている。既定の `collapse_mode: session` で 1 世代に集約されることを説明する。
- セッションをまたいだ再記録も多い（タブの復元など）場合は `always` を検討する。ただし、本当に同じ広告から 2 回来た場合も 1 世代になる。

### q6 パスとページ分類
- `page_type = other` の上位パターンを見て、`pages.*_regex` に追加する。
- 商品詳細（`pdp`）の `product_id_rate` が 1 に近いことを確認する。低ければ `product_id_regex` を直す。

### q7〜q9 結合のキー
- q7: `found_in_member` / `found_in_pos` が低い場合は、桁数（ゼロ埋め）、プレフィックス、ハッシュ化の違いを疑い、`member_id_expr` で揃える（例: `LPAD(CAST(member_id AS VARCHAR), 10, '0')`）。
- q8: 一致率が高ければ `order_id_matches_web: true`。売上と購入商品を POS から補える。
- q9: 一致率が低い場合、Web が品番・POS が SKU のことが多い。`source.pos.product_id_expr` で品番に変換する（例: `SUBSTR(sku, 1, 8)`）。一致しないままだと、メールで閲覧した商品の「同一商品購入」が店舗分を数えられない。
