-- Q6 パスの上位パターン（直近7日、数字・長い英数字は # に置換）と、現在のページ分類の結果
WITH h AS (
  SELECT
    COALESCE(NULLIF(regexp_replace(${source.weblog.url_col}, '^[a-zA-Z]+://[^/]+', ''), ''), '/') AS path_query
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-7d', '${common.td_tz}')
    AND ${source.weblog.filter_condition}
)
SELECT
  regexp_replace(regexp_replace(regexp_replace(path_query, '\?.*$', ''), '[0-9]+', '#'), '/[A-Za-z0-9_-]{12,}', '/<id>') AS path_pattern
  , CASE
      WHEN regexp_like(path_query, '${pages.cart_regex}') THEN 'cart'
      WHEN regexp_like(path_query, '${pages.checkout_regex}') THEN 'checkout'
      WHEN regexp_like(path_query, '${pages.register_regex}') THEN 'register'
      WHEN regexp_like(path_query, '${pages.product_regex}') THEN 'pdp'
      WHEN regexp_like(path_query, '${pages.search_regex}') THEN 'search'
      WHEN regexp_like(path_query, '${pages.category_regex}') THEN 'category'
      WHEN regexp_like(path_query, '${pages.mypage_regex}') THEN 'mypage'
      WHEN regexp_like(path_query, '${pages.content_regex}') THEN 'content'
      WHEN regexp_like(path_query, '${pages.top_regex}') THEN 'top'
      ELSE 'other'
    END AS page_type
  , COUNT(*) AS hits
  , AVG(CASE WHEN NULLIF(regexp_extract(path_query, '${pages.product_id_regex}', 1), '') IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS product_id_rate
FROM h
GROUP BY 1, 2
ORDER BY hits DESC
LIMIT 100
