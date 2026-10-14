-- gp_freq_combos: 1注文で複数の値（例: 複数カテゴリ）を買ったときの組み合わせ（購入回数・軸ごとの上位 20）
--   combo は表示する値（上位 top_nodes 件と「その他」）で作る。「その他」だけの組み合わせもある
WITH c AS (
  SELECT
    dimension
    , step
    , combo
    , COUNT(*) AS orders
    , SUM(reached) AS orders_reached
  FROM gp_freq_orders
  WHERE mode = 'primary'
    AND combo IS NOT NULL
  GROUP BY dimension, step, combo
)
, t AS (
  SELECT
    dimension
    , step
    , COUNT(*) AS orders_all
    , SUM(reached) AS orders_all_reached
  FROM gp_freq_orders
  WHERE mode = 'primary'
  GROUP BY dimension, step
)
SELECT
  c.dimension
  , c.step
  , c.combo
  , c.orders
  , c.orders_reached
  , t.orders_all
  , t.orders_all_reached
  , c.rnk
FROM (
  SELECT c.*, ROW_NUMBER() OVER (PARTITION BY dimension, step ORDER BY orders DESC, combo) AS rnk FROM c
) c
JOIN t ON t.dimension = c.dimension AND t.step = c.step
WHERE c.rnk <= 20
