-- gp_cv_journey_items: コンバージョン × 商品グループ（1つの CV で複数グループを買った場合は複数行）
SELECT
  i.cv_id
  , CASE '${golden_path.product_level}'
      WHEN 'brand' THEN i.brand
      WHEN 'product' THEN COALESCE(i.product_name, i.product_id)
      ELSE i.category
    END AS product_group
  , SUM(COALESCE(i.amount, 0)) AS item_revenue
  , SUM(i.quantity) AS item_quantity
FROM gp_cv_items i
GROUP BY 1, 2
