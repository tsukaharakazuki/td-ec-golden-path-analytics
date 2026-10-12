-- gp_email_product (Q3): メール × 閲覧商品ごとの、閲覧者数と同一商品の購入
WITH agg AS (
  SELECT
    v.email_key
    , v.product_id
    , COUNT(DISTINCT v.person_key) AS viewers
    , SUM(v.views) AS views
    , SUM(v.purchased_same) AS same_product_buyers
    , SUM(v.same_revenue) AS same_product_revenue
    , SUM(v.same_store_revenue) AS same_product_store_revenue
    , SUM(v.purchased_other) AS other_product_buyers
  FROM gp_email_view_purchase v
  GROUP BY v.email_key, v.product_id
)
SELECT *
FROM (
  SELECT
    a.*
    , CAST(a.same_product_buyers AS DOUBLE) / NULLIF(a.viewers, 0) AS same_product_rate
    , d.product_name
    , d.category
    , d.brand
    , ROW_NUMBER() OVER (PARTITION BY a.email_key ORDER BY a.viewers DESC, a.same_product_buyers DESC) AS rank_in_email
  FROM agg a
  LEFT JOIN gp_product_dim d ON d.product_id = a.product_id
) x
WHERE rank_in_email <= 50
