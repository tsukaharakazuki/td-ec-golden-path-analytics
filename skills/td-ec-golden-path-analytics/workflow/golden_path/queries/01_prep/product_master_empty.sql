-- gp_product_master: 商品マスタを使わない場合の空テーブル（スキーマのみ）
SELECT
  CAST(NULL AS VARCHAR) AS product_id
  , CAST(NULL AS VARCHAR) AS product_name
  , CAST(NULL AS VARCHAR) AS category
  , CAST(NULL AS VARCHAR) AS brand
WHERE 1 = 0
