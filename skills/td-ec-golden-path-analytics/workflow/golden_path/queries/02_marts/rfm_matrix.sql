-- gp_rfm_matrix: RFM 125 ブロック（R × F × M、各1〜5）の人数・売上
WITH grid AS (
  SELECT r, f, m
  FROM UNNEST(sequence(1, 5)) AS a (r)
  CROSS JOIN UNNEST(sequence(1, 5)) AS b (f)
  CROSS JOIN UNNEST(sequence(1, 5)) AS c (m)
)
, agg AS (
  SELECT
    r_score AS r
    , f_score AS f
    , m_score AS m
    , COUNT(*) AS customers
    , SUM(monetary) AS revenue
    , SUM(frequency) AS orders
    , AVG(recency_days) AS avg_recency_days
    , SUM(ec_monetary) AS ec_revenue
    , SUM(is_loyal) AS loyal_customers
  FROM gp_rfm_customer
  GROUP BY 1, 2, 3
)
SELECT
  g.r
  , g.f
  , g.m
  , 'R' || CAST(g.r AS VARCHAR) || 'F' || CAST(g.f AS VARCHAR) || 'M' || CAST(g.m AS VARCHAR) AS rfm_cell
  , COALESCE(a.customers, 0) AS customers
  , COALESCE(a.revenue, 0) AS revenue
  , COALESCE(a.orders, 0) AS orders
  , a.avg_recency_days
  , COALESCE(a.ec_revenue, 0) AS ec_revenue
  , COALESCE(a.loyal_customers, 0) AS loyal_customers
FROM grid g
LEFT JOIN agg a ON a.r = g.r AND a.f = g.f AND a.m = g.m
