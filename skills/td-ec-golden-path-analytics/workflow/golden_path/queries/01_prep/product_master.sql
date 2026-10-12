-- gp_product_master: 商品マスタ（1商品1行）
SELECT
  product_id
  , MAX(product_name) AS product_name
  , MAX(category) AS category
  , MAX(brand) AS brand
FROM (
  SELECT
    CAST(${source.product.product_id_expr} AS VARCHAR) AS product_id
    , CAST(${source.product.product_name_expr} AS VARCHAR) AS product_name
    , CAST(${source.product.category_expr} AS VARCHAR) AS category
    , CAST(${source.product.brand_expr} AS VARCHAR) AS brand
  FROM ${source.product.db}.${source.product.table}
) p
WHERE product_id IS NOT NULL
GROUP BY product_id
