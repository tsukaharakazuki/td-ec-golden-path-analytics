-- gp_order_lines: POS を使わない場合の空テーブル（スキーマのみ）
SELECT
  CAST(NULL AS VARCHAR) AS member_id
  , CAST(NULL AS VARCHAR) AS order_id
  , CAST(NULL AS BIGINT) AS order_time
  , CAST(NULL AS VARCHAR) AS channel
  , CAST(NULL AS VARCHAR) AS product_id
  , CAST(NULL AS VARCHAR) AS product_name
  , CAST(NULL AS VARCHAR) AS category
  , CAST(NULL AS VARCHAR) AS brand
  , CAST(NULL AS DOUBLE) AS quantity
  , CAST(NULL AS DOUBLE) AS amount
WHERE 1 = 0
