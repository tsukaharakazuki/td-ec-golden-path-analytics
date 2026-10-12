-- gp_members: 会員データを使わない場合の空テーブル（スキーマのみ）
SELECT
  CAST(NULL AS VARCHAR) AS member_id
  , CAST(NULL AS BIGINT) AS register_time
  , CAST(NULL AS VARCHAR) AS gender
  , CAST(NULL AS VARCHAR) AS age_band
  , CAST(NULL AS VARCHAR) AS prefecture
WHERE 1 = 0
