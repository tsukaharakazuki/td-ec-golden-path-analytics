-- Q2 購入完了ページの候補（直近30日）: 完了・サンクス系のパス（数字は # に置換）と、注文ID・ecommerce の有無
SELECT
  regexp_replace(url_extract_path(${source.weblog.url_col}), '[0-9]+', '#') AS path_pattern
  , COUNT(*) AS hits
  , approx_distinct(${source.weblog.cookie_col}) AS cookies
  , AVG(CASE WHEN regexp_like(${source.weblog.url_col}, '[?&](order_?id|orderno|order_no|oid|transaction_?id)=') THEN 1.0e0 ELSE 0.0e0 END) AS order_param_rate
  , AVG(CASE WHEN CAST(${ecommerce.column_expr} AS VARCHAR) IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS ecommerce_rate
  , AVG(CASE WHEN ${cv.condition} THEN 1.0e0 ELSE 0.0e0 END) AS matches_current_condition
FROM ${source.weblog.db}.${source.weblog.table}
WHERE TD_INTERVAL(time, '-30d', '${common.td_tz}')
  AND regexp_like(LOWER(${source.weblog.url_col}), '(complete|thanks|thankyou|finish|done|success|receipt|order)')
GROUP BY 1
ORDER BY hits DESC
LIMIT 40
