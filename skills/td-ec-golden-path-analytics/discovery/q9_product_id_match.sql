-- Q9 商品詳細ページの商品ID と、POS の商品キーの一致率（直近30日）→ pages.product_id_regex / source.pos.product_id_expr
WITH web AS (
  SELECT
    regexp_extract(COALESCE(NULLIF(regexp_replace(${source.weblog.url_col}, '^[a-zA-Z]+://[^/]+', ''), ''), '/'), '${pages.product_id_regex}', 1) AS product_id
    , COUNT(*) AS views
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-30d', '${common.td_tz}')
    AND regexp_like(COALESCE(NULLIF(regexp_replace(${source.weblog.url_col}, '^[a-zA-Z]+://[^/]+', ''), ''), '/'), '${pages.product_regex}')
  GROUP BY 1
)
, pos AS (
  SELECT DISTINCT CAST(${source.pos.product_id_expr} AS VARCHAR) AS product_id
  FROM ${source.pos.db}.${source.pos.table}
  WHERE ${source.pos.partition_filter}
)
SELECT
  COUNT(*) AS web_products
  , SUM(web.views) AS views
  , AVG(CASE WHEN web.product_id IS NULL THEN 1.0e0 ELSE 0.0e0 END) AS no_product_id_rate
  , AVG(CASE WHEN pos.product_id IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS found_in_pos_rate
  , CAST(SUM(CASE WHEN pos.product_id IS NOT NULL THEN web.views ELSE 0 END) AS DOUBLE) / NULLIF(SUM(web.views), 0) AS found_in_pos_view_weighted
FROM web
LEFT JOIN pos ON pos.product_id = web.product_id
