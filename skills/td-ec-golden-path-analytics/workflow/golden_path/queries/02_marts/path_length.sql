-- gp_path_length: 経路の長さ（世代数）と CV までの日数の分布
SELECT
  'generations' AS metric
  , CAST(n_gen AS VARCHAR) AS bucket
  , n_gen AS bucket_order
  , COUNT(*) AS conversions
  , SUM(revenue) AS revenue
FROM gp_cv_journey
GROUP BY n_gen
UNION ALL
SELECT
  'days_to_cv' AS metric
  , bucket
  , bucket_order
  , COUNT(*) AS conversions
  , SUM(revenue) AS revenue
FROM (
  SELECT
    revenue
    , CASE
        WHEN days_to_cv < 1 THEN '当日'
        WHEN days_to_cv < 3 THEN '1〜2日'
        WHEN days_to_cv < 7 THEN '3〜6日'
        WHEN days_to_cv < 14 THEN '7〜13日'
        WHEN days_to_cv < 21 THEN '14〜20日'
        ELSE '21日以上'
      END AS bucket
    , CASE
        WHEN days_to_cv < 1 THEN 1
        WHEN days_to_cv < 3 THEN 2
        WHEN days_to_cv < 7 THEN 3
        WHEN days_to_cv < 14 THEN 4
        WHEN days_to_cv < 21 THEN 5
        ELSE 6
      END AS bucket_order
  FROM gp_cv_journey
) d
GROUP BY bucket, bucket_order
