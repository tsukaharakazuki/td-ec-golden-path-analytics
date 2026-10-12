-- gp_id_map: cookie → 会員ID（Webログ内のログイン記録のみから作成）
-- 1 cookie に複数の会員IDがある場合は、最も多く記録された会員IDを採用（共有端末対策）
WITH pairs AS (
  SELECT
    CAST(${source.weblog.cookie_col} AS VARCHAR) AS cookie
    , ${source.weblog.member_id_expr} AS member_id
    , COUNT(*) AS hits
    , MAX(time) AS last_seen
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-${common.weblog_lookback_days}d', '${common.td_tz}')
    AND ${source.weblog.filter_condition}
  GROUP BY 1, 2
)
SELECT cookie, member_id
FROM (
  SELECT
    cookie
    , member_id
    , ROW_NUMBER() OVER (PARTITION BY cookie ORDER BY hits DESC, last_seen DESC) AS rn
  FROM pairs
  WHERE cookie IS NOT NULL AND member_id IS NOT NULL AND member_id <> ''
) x
WHERE rn = 1
