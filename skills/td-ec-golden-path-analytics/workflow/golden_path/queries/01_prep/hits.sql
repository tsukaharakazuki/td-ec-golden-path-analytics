-- gp_hits: Webログ（td-js-sdk）を1ヒット1行に正規化する
--   - 人物キー（会員IDで cookie を束ねる / cookie のまま）
--   - セッション（無操作 ${touch.session_timeout_minutes} 分で区切る）
--   - ページ種別・商品ID
--   - 購入完了ヒット・注文ID・ecommerce JSON
--   - 流入タッチの候補（utm / 広告クリックID / 外部リファラ / セッション先頭の直接流入）
WITH raw AS (
  SELECT
    time
    , CAST(${source.weblog.cookie_col} AS VARCHAR) AS cookie
    , NULLIF(CAST(${source.weblog.member_id_expr} AS VARCHAR), '') AS member_id_raw
    , CAST(${source.weblog.url_col} AS VARCHAR) AS url
    , CAST(${source.weblog.referrer_col} AS VARCHAR) AS referrer
    , CAST(${source.weblog.user_agent_expr} AS VARCHAR) AS user_agent
    , CASE WHEN ${cv.condition} THEN 1 ELSE 0 END AS is_cv_hit
    , NULLIF(CAST(${cv.order_id_expr} AS VARCHAR), '') AS cv_order_id_raw
    , CAST(${ecommerce.column_expr} AS VARCHAR) AS ecommerce_json
    , CASE WHEN ${touch.exclude_hit_condition} THEN 1 ELSE 0 END AS is_excluded_hit
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-${common.weblog_lookback_days}d', '${common.td_tz}')
    AND ${source.weblog.filter_condition}
    AND ${source.weblog.cookie_col} IS NOT NULL
)
, parsed AS (
  SELECT
    r.*
    , LOWER(url_extract_host(r.url)) AS page_host
    , COALESCE(NULLIF(regexp_replace(r.url, '^[a-zA-Z]+://[^/]+', ''), ''), '/') AS path_query
    , LOWER(url_extract_host(r.referrer)) AS referrer_host
    , COALESCE(TRY(url_decode(url_extract_parameter(r.url, 'utm_source'))), url_extract_parameter(r.url, 'utm_source')) AS utm_source
    , COALESCE(TRY(url_decode(url_extract_parameter(r.url, 'utm_medium'))), url_extract_parameter(r.url, 'utm_medium')) AS utm_medium
    , COALESCE(TRY(url_decode(url_extract_parameter(r.url, 'utm_campaign'))), url_extract_parameter(r.url, 'utm_campaign')) AS utm_campaign
    , COALESCE(TRY(url_decode(url_extract_parameter(r.url, 'utm_content'))), url_extract_parameter(r.url, 'utm_content')) AS utm_content
    , url_extract_parameter(r.url, 'gclid') AS gclid
    , url_extract_parameter(r.url, 'yclid') AS yclid
    , url_extract_parameter(r.url, 'msclkid') AS msclkid
    , url_extract_parameter(r.url, 'fbclid') AS fbclid
    , m.member_id AS member_id_mapped
  FROM raw r
  LEFT JOIN gp_id_map m
    ON m.cookie = r.cookie
)
, keyed AS (
  SELECT
    p.*
    , COALESCE(p.member_id_raw, p.member_id_mapped) AS member_id
    , CASE
        WHEN '${common.id_stitching}' = 'member'
          THEN COALESCE(p.member_id_mapped, p.member_id_raw, 'c:' || p.cookie)
        ELSE 'c:' || p.cookie
      END AS person_key
  FROM parsed p
)
, seq AS (
  SELECT
    k.*
    , ROW_NUMBER() OVER (PARTITION BY k.person_key ORDER BY k.time, k.url, k.referrer) AS hit_seq
  FROM keyed k
)
, gap AS (
  SELECT
    s.*
    , LAG(s.time) OVER (PARTITION BY s.person_key ORDER BY s.hit_seq) AS prev_time
  FROM seq s
)
, sess AS (
  SELECT
    g.*
    , CASE
        WHEN g.prev_time IS NULL OR g.time - g.prev_time > ${touch.session_timeout_minutes} * 60 THEN 1
        ELSE 0
      END AS is_session_start
  FROM gap g
)
, sess2 AS (
  SELECT
    s.*
    , SUM(s.is_session_start) OVER (
        PARTITION BY s.person_key ORDER BY s.hit_seq
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS session_num
  FROM sess s
)
, classified AS (
  SELECT
    s.*
    , CASE
        WHEN s.utm_source IS NOT NULL OR s.utm_medium IS NOT NULL THEN 1 ELSE 0
      END AS has_utm
    , CASE
        WHEN s.referrer_host IS NULL OR s.referrer_host = '' THEN 0
        WHEN regexp_like(s.referrer_host, '${touch.internal_host_regex}') THEN 0
        WHEN s.page_host IS NOT NULL AND s.referrer_host = s.page_host THEN 0
        ELSE 1
      END AS is_external_ref
    , CASE
        WHEN s.referrer_host IS NOT NULL AND regexp_like(s.referrer_host, '${touch.exclude_referrer_regex}') THEN 1
        ELSE 0
      END AS is_excluded_ref
    , CASE
        WHEN s.is_cv_hit = 1 THEN 'cv'
        WHEN regexp_like(s.path_query, '${pages.cart_regex}') THEN 'cart'
        WHEN regexp_like(s.path_query, '${pages.checkout_regex}') THEN 'checkout'
        WHEN regexp_like(s.path_query, '${pages.register_regex}') THEN 'register'
        WHEN regexp_like(s.path_query, '${pages.product_regex}') THEN 'pdp'
        WHEN regexp_like(s.path_query, '${pages.search_regex}') THEN 'search'
        WHEN regexp_like(s.path_query, '${pages.category_regex}') THEN 'category'
        WHEN regexp_like(s.path_query, '${pages.mypage_regex}') THEN 'mypage'
        WHEN regexp_like(s.path_query, '${pages.content_regex}') THEN 'content'
        WHEN regexp_like(s.path_query, '${pages.top_regex}') THEN 'top'
        ELSE 'other'
      END AS page_type
  FROM sess2 s
)
, touched AS (
  SELECT
    c.*
    , CASE
        WHEN c.is_excluded_hit = 1 THEN NULL
        WHEN c.has_utm = 1 AND regexp_like(COALESCE(LOWER(c.utm_source), ''), '${touch.exclude_utm_source_regex}') THEN NULL
        WHEN c.has_utm = 1 THEN 'utm'
        WHEN c.gclid IS NOT NULL OR c.yclid IS NOT NULL OR c.msclkid IS NOT NULL THEN 'click_id'
        WHEN c.is_excluded_ref = 1 THEN NULL
        WHEN c.is_external_ref = 1 THEN 'referrer'
        WHEN c.is_session_start = 1 THEN 'direct'
        ELSE NULL
      END AS touch_type
  FROM classified c
)
SELECT
  t.time
  , t.hit_seq
  , t.person_key
  , t.cookie
  , t.member_id
  , t.session_num
  , t.person_key || '#' || CAST(t.session_num AS VARCHAR) AS session_id
  , t.is_session_start
  , t.page_host
  , SUBSTR(t.path_query, 1, 500) AS path_query
  , t.referrer_host
  , t.page_type
  , CASE
      WHEN t.page_type = 'pdp' THEN NULLIF(regexp_extract(t.path_query, '${pages.product_id_regex}', 1), '')
    END AS product_id
  , t.is_cv_hit
  , t.cv_order_id_raw
  , CASE WHEN t.is_cv_hit = 1 THEN t.ecommerce_json END AS ecommerce_json
  , t.is_excluded_hit
  , t.is_excluded_ref
  , t.has_utm
  , CASE
      WHEN t.user_agent IS NOT NULL AND regexp_like(t.user_agent, '(?i)(iphone|android.+mobile|mobile safari|windows phone)') THEN 1
      ELSE 0
    END AS is_mobile
  , t.touch_type
  , CASE t.touch_type
      WHEN 'utm' THEN LOWER(COALESCE(t.utm_source, '(not set)'))
      WHEN 'click_id' THEN
        CASE
          WHEN t.gclid IS NOT NULL THEN 'google'
          WHEN t.yclid IS NOT NULL THEN 'yahoo'
          ELSE 'bing'
        END
      WHEN 'referrer' THEN t.referrer_host
      WHEN 'direct' THEN '(direct)'
    END AS t_source
  , CASE t.touch_type
      WHEN 'utm' THEN LOWER(COALESCE(t.utm_medium, '(not set)'))
      WHEN 'click_id' THEN 'cpc'
      WHEN 'referrer' THEN
        CASE
          WHEN regexp_like(t.referrer_host, '${touch.search_engine_regex}') THEN 'organic'
          ELSE 'referral'
        END
      WHEN 'direct' THEN '(none)'
    END AS t_medium
  , CASE
      WHEN t.touch_type = 'utm' THEN COALESCE(t.utm_campaign, '(not set)')
      WHEN t.touch_type IS NOT NULL THEN '(none)'
    END AS t_campaign
  , CASE
      WHEN t.touch_type = 'utm' THEN COALESCE(t.utm_content, '(not set)')
      WHEN t.touch_type IS NOT NULL THEN '(none)'
    END AS t_content
FROM touched t
