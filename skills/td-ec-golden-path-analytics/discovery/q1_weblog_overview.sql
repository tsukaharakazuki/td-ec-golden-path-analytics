-- Q1 Webログの概要（直近7日）: 件数、cookie 数、会員ID・utm・ecommerce の付与率、ホスト
SELECT
  LOWER(url_extract_host(${source.weblog.url_col})) AS host
  , COUNT(*) AS hits
  , approx_distinct(${source.weblog.cookie_col}) AS cookies
  , AVG(CASE WHEN NULLIF(CAST(${source.weblog.member_id_expr} AS VARCHAR), '') IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS member_id_rate
  , AVG(CASE WHEN url_extract_parameter(${source.weblog.url_col}, 'utm_source') IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS utm_rate
  , AVG(CASE WHEN CAST(${ecommerce.column_expr} AS VARCHAR) IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS ecommerce_rate
  , MIN(time) AS min_time
  , MAX(time) AS max_time
FROM ${source.weblog.db}.${source.weblog.table}
WHERE TD_INTERVAL(time, '-7d', '${common.td_tz}')
GROUP BY 1
ORDER BY hits DESC
LIMIT 30
