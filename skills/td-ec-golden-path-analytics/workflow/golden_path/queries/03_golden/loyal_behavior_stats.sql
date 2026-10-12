-- gp_loyal_behavior_stats (Q1): 商品グループ × ロイヤル／それ以外 の行動指標の比較
WITH cv AS (
  SELECT *
  FROM gp_cv_journey
  WHERE is_loyal IS NOT NULL
)
, cvp AS (
  SELECT cv.*, ji.product_group, ji.item_revenue
  FROM cv
  JOIN gp_cv_journey_items ji ON ji.cv_id = cv.cv_id
)
, base AS (
  SELECT product_group, cv_id, person_key, is_loyal, item_revenue AS revenue, n_gen, days_to_cv, sessions_to_cv,
         pdp_views_to_cv, used_search, used_content, is_mobile, has_email_touch, has_paid_touch, repurchased, repeat_eligible
  FROM cvp
  UNION ALL
  SELECT '(全商品)' AS product_group, cv_id, person_key, is_loyal, revenue, n_gen, days_to_cv, sessions_to_cv,
         pdp_views_to_cv, used_search, used_content, is_mobile, has_email_touch, has_paid_touch, repurchased, repeat_eligible
  FROM cv
)
SELECT
  product_group
  , CASE WHEN is_loyal = 1 THEN 'loyal' ELSE 'other' END AS customer_type
  , COUNT(*) AS conversions
  , COUNT(DISTINCT person_key) AS customers
  , SUM(revenue) AS revenue
  , AVG(revenue) AS avg_revenue
  , AVG(CAST(n_gen AS DOUBLE)) AS avg_generations
  , AVG(days_to_cv) AS avg_days_to_cv
  , AVG(CAST(sessions_to_cv AS DOUBLE)) AS avg_sessions_to_cv
  , AVG(CAST(pdp_views_to_cv AS DOUBLE)) AS avg_pdp_views
  , AVG(CAST(used_search AS DOUBLE)) AS search_rate
  , AVG(CAST(used_content AS DOUBLE)) AS content_rate
  , AVG(CAST(is_mobile AS DOUBLE)) AS mobile_rate
  , AVG(CAST(has_email_touch AS DOUBLE)) AS email_touch_rate
  , AVG(CAST(has_paid_touch AS DOUBLE)) AS paid_touch_rate
  , CAST(SUM(CASE WHEN repeat_eligible = 1 THEN repurchased ELSE 0 END) AS DOUBLE)
      / NULLIF(SUM(repeat_eligible), 0) AS repurchase_rate
FROM base
GROUP BY 1, 2
