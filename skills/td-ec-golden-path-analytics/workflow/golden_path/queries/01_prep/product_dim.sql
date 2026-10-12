-- gp_product_dim: 商品ディメンション（商品マスタ → POS 明細 → ecommerce の順に補完）
WITH u AS (
  SELECT product_id, product_name, category, brand, 1 AS pri FROM gp_product_master
  UNION ALL
  SELECT product_id, product_name, category, brand, 2 AS pri FROM gp_order_lines
  UNION ALL
  SELECT product_id, product_name, category, brand, 3 AS pri FROM gp_cv_items
)
SELECT
  product_id
  , min_by(product_name, pri * 10 + CASE WHEN product_name IS NULL THEN 5 ELSE 0 END) AS product_name
  , min_by(category, pri * 10 + CASE WHEN category IS NULL OR category = '(不明)' THEN 5 ELSE 0 END) AS category
  , min_by(brand, pri * 10 + CASE WHEN brand IS NULL OR brand = '(不明)' THEN 5 ELSE 0 END) AS brand
FROM u
WHERE product_id IS NOT NULL
GROUP BY product_id
