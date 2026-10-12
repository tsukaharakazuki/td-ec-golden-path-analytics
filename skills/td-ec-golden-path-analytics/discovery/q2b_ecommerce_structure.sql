-- Q2b ecommerce JSON の構造（直近7日・値は出さずキー名だけ）
-- top_keys: ecommerce 直下のキー / item_keys: items[0] のキー
SELECT
  array_join(array_sort(map_keys(TRY_CAST(json_parse(CAST(${ecommerce.column_expr} AS VARCHAR)) AS MAP(VARCHAR, JSON)))), ', ') AS top_keys
  , array_join(array_sort(map_keys(TRY_CAST(json_extract(CAST(${ecommerce.column_expr} AS VARCHAR), '${ecommerce.items_path}[0]') AS MAP(VARCHAR, JSON)))), ', ') AS item_keys
  , COUNT(*) AS hits
  , AVG(CASE WHEN ${cv.condition} THEN 1.0e0 ELSE 0.0e0 END) AS cv_condition_rate
FROM ${source.weblog.db}.${source.weblog.table}
WHERE TD_INTERVAL(time, '-7d', '${common.td_tz}')
  AND CAST(${ecommerce.column_expr} AS VARCHAR) IS NOT NULL
GROUP BY 1, 2
ORDER BY hits DESC
LIMIT 20
