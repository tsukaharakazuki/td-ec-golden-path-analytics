-- gp_email_influence (Q3): メール（touch_key）ごとのサマリー
--   セッション → 商品閲覧 → 同一商品購入（EC / 店舗）、別商品購入、アトリビューション上の貢献
WITH es AS (
  SELECT
    entry_touch_key AS email_key
    , MAX(entry_source) AS source
    , MAX(entry_medium) AS medium
    , MAX(entry_campaign) AS campaign
    , COUNT(*) AS sessions
    , COUNT(DISTINCT person_key) AS persons
    , COUNT_IF(product_views > 0) AS sessions_with_pdp
    , SUM(has_cv) AS cv_sessions
    , MIN(session_start) AS first_session_time
  FROM gp_sessions
  WHERE regexp_like(entry_medium, '${email.medium_regex}')
     OR regexp_like(entry_source, '${email.source_regex}')
  GROUP BY entry_touch_key
)
, vp AS (
  SELECT
    email_key
    , COUNT(*) AS viewer_product_pairs
    , COUNT(DISTINCT person_key) AS viewers
    , COUNT(DISTINCT product_id) AS distinct_products_viewed
    , SUM(purchased_same) AS same_product_pairs
    , COUNT(DISTINCT CASE WHEN purchased_same = 1 THEN person_key END) AS same_product_buyers
    , SUM(same_revenue) AS same_product_revenue
    , SUM(same_store_revenue) AS same_product_store_revenue
    , COUNT(DISTINCT CASE WHEN purchased_other = 1 AND purchased_same = 0 THEN person_key END) AS other_product_only_buyers
    , approx_percentile(days_to_same_purchase, 0.5e0) AS median_days_to_same_purchase
  FROM gp_email_view_purchase
  GROUP BY email_key
)
SELECT
  es.*
  , COALESCE(vp.viewer_product_pairs, 0) AS viewer_product_pairs
  , COALESCE(vp.viewers, 0) AS viewers
  , COALESCE(vp.distinct_products_viewed, 0) AS distinct_products_viewed
  , COALESCE(vp.same_product_pairs, 0) AS same_product_pairs
  , COALESCE(vp.same_product_buyers, 0) AS same_product_buyers
  , CAST(COALESCE(vp.same_product_pairs, 0) AS DOUBLE) / NULLIF(vp.viewer_product_pairs, 0) AS same_product_rate
  , COALESCE(vp.same_product_revenue, 0) AS same_product_revenue
  , COALESCE(vp.same_product_store_revenue, 0) AS same_product_store_revenue
  , COALESCE(vp.other_product_only_buyers, 0) AS other_product_only_buyers
  , vp.median_days_to_same_purchase
  , a.conv_linear
  , a.conv_last
  , a.rev_linear
  , a.rev_last
FROM es
LEFT JOIN vp ON vp.email_key = es.email_key
LEFT JOIN gp_attribution_summary a ON a.touch_key = es.email_key
