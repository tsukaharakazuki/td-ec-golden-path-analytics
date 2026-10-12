-- gp_order_lines: POS（店舗＋EC）の購買明細を正規化
SELECT
  member_id
  , order_id
  , order_time
  , channel
  , product_id
  , product_name
  , category
  , brand
  , quantity
  , amount
FROM (
  SELECT
    NULLIF(CAST(${source.pos.member_id_expr} AS VARCHAR), '') AS member_id
    , CAST(${source.pos.order_id_expr} AS VARCHAR) AS order_id
    , CAST(${source.pos.order_time_expr} AS BIGINT) AS order_time
    , LOWER(CAST(${source.pos.channel_expr} AS VARCHAR)) AS channel
    , CAST(${source.pos.product_id_expr} AS VARCHAR) AS product_id
    , CAST(${source.pos.product_name_expr} AS VARCHAR) AS product_name
    , CAST(${source.pos.category_expr} AS VARCHAR) AS category
    , CAST(${source.pos.brand_expr} AS VARCHAR) AS brand
    , CAST(${source.pos.quantity_expr} AS DOUBLE) AS quantity
    , CAST(${source.pos.amount_expr} AS DOUBLE) AS amount
  FROM ${source.pos.db}.${source.pos.table}
  WHERE ${source.pos.partition_filter}
    AND ${source.pos.valid_condition}
) p
WHERE order_id IS NOT NULL
  AND order_time >= TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') - ${common.pos_lookback_days} * 86400
  AND order_time < TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}')
