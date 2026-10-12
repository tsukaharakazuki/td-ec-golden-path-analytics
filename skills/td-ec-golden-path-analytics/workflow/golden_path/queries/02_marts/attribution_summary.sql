-- gp_attribution_summary: touch_key（attribution.grain の粒度）ごとの、モデル別の貢献 CV 数・売上
WITH credit AS (
  SELECT
    touch_key
    , MAX(channel) AS channel
    , MAX(source) AS source
    , MAX(medium) AS medium
    , MAX(campaign) AS campaign
    , COUNT(DISTINCT cv_id) AS cv_paths
    , COUNT(DISTINCT CASE WHEN generation < n_gen THEN cv_id END) AS assisted_cv
    , SUM(credit_first) AS conv_first
    , SUM(credit_last) AS conv_last
    , SUM(credit_linear) AS conv_linear
    , SUM(credit_decay) AS conv_decay
    , SUM(credit_u) AS conv_u
    , SUM(credit_first * revenue) AS rev_first
    , SUM(credit_last * revenue) AS rev_last
    , SUM(credit_linear * revenue) AS rev_linear
    , SUM(credit_decay * revenue) AS rev_decay
    , SUM(credit_u * revenue) AS rev_u
    , AVG(days_before_cv) AS avg_days_before_cv
  FROM gp_attribution_credits
  GROUP BY touch_key
)
, touches AS (
  SELECT
    touch_key
    , COUNT(*) AS touches
    , COUNT(DISTINCT person_key) AS reach_persons
  FROM gp_touchpoints
  GROUP BY touch_key
)
SELECT
  c.*
  , COALESCE(t.touches, 0) AS touches
  , COALESCE(t.reach_persons, 0) AS reach_persons
  , CASE WHEN t.touches > 0 THEN c.conv_linear / t.touches END AS conv_linear_per_touch
FROM credit c
LEFT JOIN touches t ON t.touch_key = c.touch_key
