-- gp_ad_product (Q2): 広告ごとに、どの商品グループの購買に貢献したか（線形・U字モデルで按分）
WITH paid AS (
  SELECT cv_id, touch_key, channel, credit_linear, credit_u, credit_last
  FROM gp_attribution_credits
  WHERE regexp_like(COALESCE(medium, ''), '${ads.paid_medium_regex}')
     OR regexp_like(channel, '${ads.paid_channel_regex}')
)
, items AS (
  SELECT
    cv_id
    , product_group
    , item_revenue
    , item_revenue / NULLIF(SUM(item_revenue) OVER (PARTITION BY cv_id), 0) AS revenue_share
    , 1.0e0 / COUNT(*) OVER (PARTITION BY cv_id) AS count_share
  FROM gp_cv_journey_items
)
, joined AS (
  SELECT
    p.touch_key
    , p.channel
    , i.product_group
    , p.cv_id
    , p.credit_linear * COALESCE(i.revenue_share, i.count_share) AS conv_linear
    , p.credit_u * COALESCE(i.revenue_share, i.count_share) AS conv_u
    , p.credit_last * COALESCE(i.revenue_share, i.count_share) AS conv_last
    , p.credit_linear * i.item_revenue AS rev_linear
    , p.credit_u * i.item_revenue AS rev_u
    , p.credit_last * i.item_revenue AS rev_last
  FROM paid p
  JOIN items i ON i.cv_id = p.cv_id
)
, agg AS (
  SELECT
    touch_key
    , MAX(channel) AS channel
    , product_group
    , COUNT(DISTINCT cv_id) AS cv_paths
    , SUM(conv_linear) AS conv_linear
    , SUM(conv_u) AS conv_u
    , SUM(conv_last) AS conv_last
    , SUM(rev_linear) AS rev_linear
    , SUM(rev_u) AS rev_u
    , SUM(rev_last) AS rev_last
  FROM joined
  GROUP BY touch_key, product_group
)
SELECT *
FROM (
  SELECT agg.*, ROW_NUMBER() OVER (PARTITION BY touch_key ORDER BY rev_linear DESC) AS rank_in_ad
  FROM agg
) x
WHERE rank_in_ad <= 30
