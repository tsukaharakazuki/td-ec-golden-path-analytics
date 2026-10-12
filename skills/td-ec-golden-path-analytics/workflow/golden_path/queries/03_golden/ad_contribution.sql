-- gp_ad_contribution (Q2): 広告（touch_key 単位）が購買にどう貢献しているか
--   モデル別の貢献 CV・売上、アシスト、役割（最初 / 中間 / 最後）の比率、
--   CV までの日数、新規顧客比率、ロイヤル顧客比率、再購入率
WITH paid AS (
  SELECT c.*
  FROM gp_attribution_credits c
  WHERE regexp_like(COALESCE(c.medium, ''), '${ads.paid_medium_regex}')
     OR regexp_like(c.channel, '${ads.paid_channel_regex}')
)
, credit AS (
  SELECT
    p.touch_key
    , MAX(p.channel) AS channel
    , MAX(p.source) AS source
    , MAX(p.medium) AS medium
    , MAX(p.campaign) AS campaign
    , COUNT(DISTINCT p.cv_id) AS cv_paths
    , COUNT(*) AS path_touches
    , COUNT(DISTINCT CASE WHEN p.generation < p.n_gen THEN p.cv_id END) AS assisted_cv
    , SUM(p.credit_first) AS conv_first
    , SUM(p.credit_last) AS conv_last
    , SUM(p.credit_linear) AS conv_linear
    , SUM(p.credit_decay) AS conv_decay
    , SUM(p.credit_u) AS conv_u
    , SUM(p.credit_first * p.revenue) AS rev_first
    , SUM(p.credit_last * p.revenue) AS rev_last
    , SUM(p.credit_linear * p.revenue) AS rev_linear
    , SUM(p.credit_decay * p.revenue) AS rev_decay
    , SUM(p.credit_u * p.revenue) AS rev_u
    , COUNT_IF(p.generation = 1 AND p.n_gen > 1) AS role_first
    , COUNT_IF(p.generation > 1 AND p.generation < p.n_gen) AS role_middle
    , COUNT_IF(p.generation = p.n_gen AND p.n_gen > 1) AS role_last
    , COUNT_IF(p.n_gen = 1) AS role_only
    , AVG(p.days_before_cv) AS avg_days_before_cv
  FROM paid p
  GROUP BY p.touch_key
)
, cv_attr AS (
  SELECT
    p.touch_key
    , AVG(CAST(j.is_new_customer AS DOUBLE)) AS new_customer_rate
    , AVG(CAST(j.is_loyal AS DOUBLE)) AS loyal_rate
    , CAST(SUM(CASE WHEN j.repeat_eligible = 1 THEN j.repurchased ELSE 0 END) AS DOUBLE)
        / NULLIF(SUM(j.repeat_eligible), 0) AS repurchase_rate
    , AVG(j.revenue) AS avg_order_value
  FROM (SELECT DISTINCT touch_key, cv_id FROM paid) p
  JOIN gp_cv_journey j ON j.cv_id = p.cv_id
  GROUP BY p.touch_key
)
, touches AS (
  SELECT touch_key, COUNT(*) AS touches, COUNT(DISTINCT person_key) AS reach_persons, COUNT(DISTINCT session_id) AS sessions
  FROM gp_touchpoints
  GROUP BY touch_key
)
SELECT
  c.*
  , a.new_customer_rate
  , a.loyal_rate
  , a.repurchase_rate
  , a.avg_order_value
  , COALESCE(t.touches, 0) AS touches
  , COALESCE(t.reach_persons, 0) AS reach_persons
  , COALESCE(t.sessions, 0) AS sessions
  , CAST(c.cv_paths AS DOUBLE) / NULLIF(t.reach_persons, 0) AS path_cv_per_person
FROM credit c
LEFT JOIN cv_attr a ON a.touch_key = c.touch_key
LEFT JOIN touches t ON t.touch_key = c.touch_key
