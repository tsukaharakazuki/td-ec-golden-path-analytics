-- gp_id_map: cookie → 会員ID（Webログ内のログイン記録 ＋ 外部の対応テーブル）
-- 優先順位: Webログで最も多く記録された会員ID → 対応テーブル
WITH weblog_pairs AS (
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
, weblog_map AS (
  SELECT cookie, member_id, 1 AS src_priority, hits
  FROM (
    SELECT
      cookie
      , member_id
      , hits
      , ROW_NUMBER() OVER (PARTITION BY cookie ORDER BY hits DESC, last_seen DESC) AS rn
    FROM weblog_pairs
    WHERE cookie IS NOT NULL AND member_id IS NOT NULL AND member_id <> ''
  ) x
  WHERE rn = 1
)
, ext_map AS (
  SELECT DISTINCT
    CAST(${source.id_map.cookie_expr} AS VARCHAR) AS cookie
    , NULLIF(CAST(${source.id_map.member_id_expr} AS VARCHAR), '') AS member_id
    , 2 AS src_priority
    , 0 AS hits
  FROM ${source.id_map.db}.${source.id_map.table}
)
SELECT cookie, member_id
FROM (
  SELECT
    cookie
    , member_id
    , ROW_NUMBER() OVER (PARTITION BY cookie ORDER BY src_priority, hits DESC, member_id) AS rn
  FROM (
    SELECT * FROM weblog_map
    UNION ALL
    SELECT * FROM ext_map WHERE cookie IS NOT NULL AND member_id IS NOT NULL
  ) u
) x
WHERE rn = 1
