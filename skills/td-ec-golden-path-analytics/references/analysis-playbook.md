# 追加分析の SQL

中間テーブルを使った追加分析のひな形。`{{db}}` を出力 DB（install.yml の `database`）に、`<...>` を対象に置き換えて `tdx query` で実行する（Trino）。
対象の名前があいまいなときは、先に「候補を探す」で正式な `touch_key` / `email_key` / 商品グループを確認する。

前提として、どの結果にも次を添える: 集計期間（`gp_dash_kpi.web_from` 〜 `web_to`）、アトリビューションのモデルと遡り日数、粒度、件数。

<!-- 各クエリは tests/sql_smoke で DuckDB 上でも動作を確認している（PLAYBOOK ブロック） -->

## 候補を探す

```sql
-- PLAYBOOK find_touch
-- 広告・メール・チャネルの touch_key を名前の一部で探す
SELECT touch_key, channel, cv_paths, conv_linear, rev_linear, touches
FROM {{db}}.gp_attribution_summary
WHERE regexp_like(LOWER(touch_key), LOWER('<名前の一部>'))
ORDER BY touches DESC
LIMIT 30
```

```sql
-- PLAYBOOK find_product_group
SELECT product_group, COUNT(*) AS cv, SUM(item_revenue) AS revenue
FROM {{db}}.gp_cv_journey_items
GROUP BY 1
ORDER BY cv DESC
LIMIT 50
```

## Q1 ロイヤル顧客の買い方

```sql
-- PLAYBOOK q1_loyal_paths
-- 商品グループ <商品グループ> を買ったロイヤル顧客の、流入経路・サイト内行動の上位（特徴度つき）
SELECT dimension, pattern, loyal_cv, other_cv, loyal_share, other_share, loyal_index
FROM {{db}}.gp_loyal_product_paths
WHERE product_group = '<商品グループ>'
  AND dimension IN ('path', 'behavior')
ORDER BY dimension, loyal_cv DESC
LIMIT 40
```

```sql
-- PLAYBOOK q1_segment_category
-- RFM セグメント × 商品グループ: どのセグメントが何を、どの入口から買っているか
SELECT
  j.segment
  , i.product_group
  , j.first_channel
  , COUNT(DISTINCT j.cv_id) AS cv
  , SUM(i.item_revenue) AS revenue
  , AVG(j.days_to_cv) AS avg_days_to_cv
FROM {{db}}.gp_cv_journey j
JOIN {{db}}.gp_cv_journey_items i ON i.cv_id = j.cv_id
WHERE j.segment IS NOT NULL
GROUP BY 1, 2, 3
HAVING COUNT(DISTINCT j.cv_id) >= 5
ORDER BY revenue DESC
LIMIT 100
```

```sql
-- PLAYBOOK q1_loyal_vs_other_steps
-- ロイヤル顧客とそれ以外で、購入までの検討の深さを比べる（商品グループ別）
SELECT product_group, customer_type, conversions, avg_sessions_to_cv, avg_pdp_views, avg_days_to_cv, search_rate, content_rate, email_touch_rate, repurchase_rate
FROM {{db}}.gp_loyal_behavior_stats
WHERE product_group IN ('(全商品)', '<商品グループ>')
ORDER BY product_group, customer_type
```

## Q2 特定の広告の購買貢献

```sql
-- PLAYBOOK q2_ad_summary
-- 広告 <touch_key> の 5 モデル比較と役割
SELECT
  touch_key, cv_paths, assisted_cv
  , conv_last, conv_first, conv_linear, conv_decay, conv_u
  , rev_last, rev_linear, rev_u
  , role_first, role_middle, role_last, role_only
  , new_customer_rate, loyal_rate, repurchase_rate, avg_order_value, avg_days_before_cv
FROM {{db}}.gp_ad_contribution
WHERE touch_key = '<touch_key>'
```

```sql
-- PLAYBOOK q2_ad_paths
-- 広告 <touch_key> を含む経路: 前後にどのチャネルが来て、何が買われたか
SELECT
  j.channel_path
  , j.main_product_group
  , COUNT(*) AS cv
  , SUM(j.revenue) AS revenue
  , AVG(CAST(j.is_new_customer AS DOUBLE)) AS new_customer_rate
FROM {{db}}.gp_cv_journey j
JOIN (
  SELECT DISTINCT cv_id FROM {{db}}.gp_attribution_credits WHERE touch_key = '<touch_key>'
) a ON a.cv_id = j.cv_id
GROUP BY 1, 2
ORDER BY cv DESC
LIMIT 50
```

```sql
-- PLAYBOOK q2_ad_after
-- 広告 <touch_key> から購入した人の、その後（再購入・店舗購入）
SELECT
  j.is_new_customer
  , COUNT(*) AS cv
  , SUM(CASE WHEN j.repeat_eligible = 1 THEN j.repurchased ELSE 0 END) AS repurchased
  , SUM(j.repeat_eligible) AS repeat_eligible
  , COUNT_IF(j.is_loyal = 1) AS loyal_now
FROM {{db}}.gp_cv_journey j
JOIN (
  SELECT DISTINCT cv_id FROM {{db}}.gp_attribution_credits WHERE touch_key = '<touch_key>'
) a ON a.cv_id = j.cv_id
GROUP BY 1
```

## Q3 特定のメールと商品

```sql
-- PLAYBOOK q3_email_summary
SELECT *
FROM {{db}}.gp_email_influence
WHERE email_key = '<email_key>'
```

```sql
-- PLAYBOOK q3_email_products
-- メール <email_key> で閲覧された商品と、同じ商品の購入（EC / 店舗）
SELECT product_id, product_name, category, viewers, same_product_buyers, same_product_rate, same_product_revenue, same_product_store_revenue, other_product_buyers
FROM {{db}}.gp_email_product
WHERE email_key = '<email_key>'
ORDER BY viewers DESC
LIMIT 50
```

```sql
-- PLAYBOOK q3_email_category
-- メール <email_key> で閲覧されたカテゴリ別の同一商品購入率（個人は出さない）
SELECT
  d.category
  , COUNT(*) AS viewer_product_pairs
  , SUM(v.purchased_same) AS purchased_same
  , CAST(SUM(v.purchased_same) AS DOUBLE) / COUNT(*) AS same_product_rate
  , SUM(v.same_revenue) AS same_revenue
  , approx_percentile(v.days_to_same_purchase, 0.5) AS median_days
FROM {{db}}.gp_email_view_purchase v
LEFT JOIN {{db}}.gp_product_dim d ON d.product_id = v.product_id
WHERE v.email_key = '<email_key>'
GROUP BY 1
ORDER BY viewer_product_pairs DESC
```

## ゴールデンパス

```sql
-- PLAYBOOK gp_why
-- 採用パターンの各要素（リフトと要素スコア）と全体平均
SELECT pattern_type, golden_rank, path_pattern, behavior_signature, product_group, score, strengths,
       conversions, cvr_lift, loyalty_lift, repeat_lift, value_index,
       c_cvr, c_loyalty, c_repeat, c_value, c_support,
       base_path_cvr, base_behavior_cvr, base_loyal_rate, base_repeat_rate, base_aov
FROM {{db}}.gp_golden_paths
ORDER BY pattern_type, golden_rank
```

```sql
-- PLAYBOOK gp_new_vs_existing
-- 新規顧客と既存顧客で、上位の経路 × 行動が違うか
SELECT is_new_customer, path_pattern, behavior_signature, COUNT(*) AS cv, SUM(revenue) AS revenue
FROM {{db}}.gp_cv_journey
GROUP BY 1, 2, 3
HAVING COUNT(*) >= 10
ORDER BY is_new_customer, cv DESC
LIMIT 60
```
