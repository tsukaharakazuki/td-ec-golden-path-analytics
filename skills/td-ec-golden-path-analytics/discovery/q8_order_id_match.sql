-- Q8 Web の注文ID と POS の注文ID の一致率（直近30日）→ source.pos.order_id_matches_web
WITH web AS (
  SELECT DISTINCT
    COALESCE(
      NULLIF(CAST(${cv.order_id_expr} AS VARCHAR), ''),
      json_extract_scalar(CAST(${ecommerce.column_expr} AS VARCHAR), '${ecommerce.transaction_id_path}')
    ) AS order_id
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-30d', '${common.td_tz}')
    AND ${cv.condition}
)
, pos AS (
  SELECT DISTINCT CAST(${source.pos.order_id_expr} AS VARCHAR) AS order_id
  FROM ${source.pos.db}.${source.pos.table}
  WHERE ${source.pos.partition_filter}
)
SELECT
  COUNT(*) AS web_orders
  , COUNT_IF(web.order_id IS NULL) AS web_cv_without_order_id
  , AVG(CASE WHEN web.order_id IS NOT NULL AND pos.order_id IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS found_in_pos_rate
FROM web
LEFT JOIN pos ON pos.order_id = web.order_id
