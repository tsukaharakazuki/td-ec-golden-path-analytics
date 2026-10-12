-- Q7 会員ID の形式と一致率（直近30日のWebログ × 会員データ × POS）
-- 値そのものは出さず、桁数と一致率だけを見る
WITH web AS (
  SELECT DISTINCT NULLIF(CAST(${source.weblog.member_id_expr} AS VARCHAR), '') AS member_id
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-30d', '${common.td_tz}')
)
, mem AS (
  SELECT DISTINCT ${source.member.member_id_expr} AS member_id
  FROM ${source.member.db}.${source.member.table}
)
, pos AS (
  SELECT DISTINCT NULLIF(CAST(${source.pos.member_id_expr} AS VARCHAR), '') AS member_id
  FROM ${source.pos.db}.${source.pos.table}
  WHERE ${source.pos.partition_filter}
)
SELECT
  'web' AS src
  , COUNT(*) AS ids
  , approx_percentile(LENGTH(member_id), 0.5e0) AS median_length
  , AVG(CASE WHEN mem.member_id IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS found_in_member
  , AVG(CASE WHEN pos.member_id IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS found_in_pos
FROM web
LEFT JOIN mem USING (member_id)
LEFT JOIN pos USING (member_id)
WHERE web.member_id IS NOT NULL
UNION ALL
SELECT
  'pos' AS src
  , COUNT(*) AS ids
  , approx_percentile(LENGTH(member_id), 0.5e0) AS median_length
  , AVG(CASE WHEN mem.member_id IS NOT NULL THEN 1.0e0 ELSE 0.0e0 END) AS found_in_member
  , 1.0e0 AS found_in_pos
FROM pos
LEFT JOIN mem USING (member_id)
WHERE pos.member_id IS NOT NULL
