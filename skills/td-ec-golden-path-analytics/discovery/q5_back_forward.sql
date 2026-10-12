-- Q5 戻る・進むによる utm の再記録（直近14日）
-- utm 付きヒットのうち、リファラが自社サイト（内部遷移）のものの割合と、
-- 同じ cookie が 30 分以内に同じ URL を既に記録していた割合。高いほど touch.collapse_mode の集約が効く。
WITH h AS (
  SELECT
    CAST(${source.weblog.cookie_col} AS VARCHAR) AS cookie
    , time
    , ${source.weblog.url_col} AS url
    , LOWER(url_extract_host(${source.weblog.referrer_col})) AS ref_host
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-14d', '${common.td_tz}')
    AND ${source.weblog.filter_condition}
    AND url_extract_parameter(${source.weblog.url_col}, 'utm_source') IS NOT NULL
)
, s AS (
  SELECT
    h.*
    , LAG(time) OVER (PARTITION BY cookie, url ORDER BY time) AS prev_same_url_time
  FROM h
)
SELECT
  COUNT(*) AS utm_hits
  , AVG(CASE WHEN ref_host IS NOT NULL AND regexp_like(ref_host, '${touch.internal_host_regex}') THEN 1.0e0 ELSE 0.0e0 END) AS internal_referrer_rate
  , AVG(CASE WHEN prev_same_url_time IS NOT NULL AND time - prev_same_url_time <= 1800 THEN 1.0e0 ELSE 0.0e0 END) AS repeated_within_30min_rate
FROM s
