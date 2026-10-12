-- Q4 utm の値の棚卸し（直近30日）: チャネル分類（channel_rules.sql）、メール・広告の判定に使う
SELECT
  LOWER(url_extract_parameter(${source.weblog.url_col}, 'utm_source')) AS utm_source
  , LOWER(url_extract_parameter(${source.weblog.url_col}, 'utm_medium')) AS utm_medium
  , url_extract_parameter(${source.weblog.url_col}, 'utm_campaign') AS utm_campaign
  , COUNT(*) AS hits
  , approx_distinct(${source.weblog.cookie_col}) AS cookies
FROM ${source.weblog.db}.${source.weblog.table}
WHERE TD_INTERVAL(time, '-30d', '${common.td_tz}')
  AND ${source.weblog.filter_condition}
  AND (url_extract_parameter(${source.weblog.url_col}, 'utm_source') IS NOT NULL
       OR url_extract_parameter(${source.weblog.url_col}, 'utm_medium') IS NOT NULL)
GROUP BY 1, 2, 3
ORDER BY hits DESC
LIMIT 300
