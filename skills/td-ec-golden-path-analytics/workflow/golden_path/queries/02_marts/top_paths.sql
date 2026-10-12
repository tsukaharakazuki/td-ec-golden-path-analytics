-- gp_top_paths: よく出現するコンバージョン経路（チャネル列）
SELECT
  channel_path
  , COUNT(*) AS conversions
  , SUM(revenue) AS revenue
  , AVG(days_to_cv) AS avg_days_to_cv
  , AVG(CAST(n_gen AS DOUBLE)) AS avg_generations
  , SUM(is_new_customer) AS new_customer_cv
  , COUNT_IF(is_loyal = 1) AS loyal_cv
FROM gp_cv_journey
GROUP BY channel_path
ORDER BY conversions DESC
LIMIT 300
