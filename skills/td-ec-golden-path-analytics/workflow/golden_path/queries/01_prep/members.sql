-- gp_members: 会員データ（1会員1行）
SELECT
  member_id
  , MIN(register_time) AS register_time
  , MAX(gender) AS gender
  , MAX(age_band) AS age_band
  , MAX(prefecture) AS prefecture
FROM (
  SELECT
    ${source.member.member_id_expr} AS member_id
    , CAST(${source.member.register_time_expr} AS BIGINT) AS register_time
    , CAST(${source.member.gender_expr} AS VARCHAR) AS gender
    , CAST(${source.member.age_band_expr} AS VARCHAR) AS age_band
    , CAST(${source.member.prefecture_expr} AS VARCHAR) AS prefecture
  FROM ${source.member.db}.${source.member.table}
  WHERE ${source.member.valid_condition}
) m
WHERE member_id IS NOT NULL AND member_id <> ''
GROUP BY member_id
