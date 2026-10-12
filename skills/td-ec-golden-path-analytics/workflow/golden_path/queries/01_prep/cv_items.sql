-- gp_cv_items: コンバージョンの購入商品
--   1. GA4 ecommerce.items があればそれを使う
--   2. 無ければ、注文IDが一致する POS 明細を使う（source.pos.order_id_matches_web: true の場合）
--   カテゴリ・ブランド・商品名は商品マスタ → 明細の値の順で採用
WITH ec_items AS (
  SELECT
    c.cv_id
    , c.person_key
    , c.member_id
    , c.cv_time
    , CAST(json_extract_scalar(item, '${ecommerce.item_id_path}') AS VARCHAR) AS product_id
    , CAST(json_extract_scalar(item, '${ecommerce.item_name_path}') AS VARCHAR) AS product_name
    , CAST(json_extract_scalar(item, '${ecommerce.item_category_path}') AS VARCHAR) AS category
    , CAST(json_extract_scalar(item, '${ecommerce.item_brand_path}') AS VARCHAR) AS brand
    , COALESCE(TRY_CAST(json_extract_scalar(item, '${ecommerce.item_quantity_path}') AS DOUBLE), 1) AS quantity
    , TRY_CAST(json_extract_scalar(item, '${ecommerce.item_price_path}') AS DOUBLE)
      * COALESCE(TRY_CAST(json_extract_scalar(item, '${ecommerce.item_quantity_path}') AS DOUBLE), 1) AS amount
    , 'ecommerce' AS item_source
  FROM gp_conversions c
  CROSS JOIN UNNEST(
    TRY_CAST(json_extract(c.ecommerce_json, '${ecommerce.items_path}') AS ARRAY(JSON))
  ) AS u (item)
  WHERE c.ecommerce_json IS NOT NULL
)
, ec_cv AS (
  SELECT DISTINCT cv_id FROM ec_items
)
, pos_items AS (
  SELECT
    c.cv_id
    , c.person_key
    , c.member_id
    , c.cv_time
    , l.product_id
    , l.product_name
    , l.category
    , l.brand
    , l.quantity
    , l.amount
    , 'pos' AS item_source
  FROM gp_conversions c
  JOIN gp_order_lines l
    ON ${source.pos.order_id_matches_web}
   AND l.order_id = c.order_id
  LEFT JOIN ec_cv e ON e.cv_id = c.cv_id
  WHERE e.cv_id IS NULL
)
, items AS (
  SELECT * FROM ec_items
  UNION ALL
  SELECT * FROM pos_items
)
SELECT
  i.cv_id
  , i.person_key
  , i.member_id
  , i.cv_time
  , i.product_id
  , COALESCE(pm.product_name, i.product_name) AS product_name
  , COALESCE(pm.category, i.category, '(不明)') AS category
  , COALESCE(pm.brand, i.brand, '(不明)') AS brand
  , i.quantity
  , i.amount
  , i.item_source
FROM items i
LEFT JOIN gp_product_master pm ON pm.product_id = i.product_id
