-- gp_freq_nodes: サンキー図の列ごとの値（ノード）の集計
--   step 1〜<max_steps> … 何回目の購入か。step = <max_steps> + 1 は最終列（累計購買金額ランクなど）
--   reached = 1 … F<max_steps> まで購入した人（最終列は到達者だけ）
--   weight       … 人数（split では人相当）
--   multi_weight … そのうち、その注文で複数の値（例: 複数カテゴリ）を購入していた分
--   amount       … 注文金額の合計（split では按分）。最終列は F<max_steps> 時点の累計購買金額の合計
WITH f AS (
  SELECT * FROM gp_freq_orders
)
, steps AS (
  SELECT
    dimension
    , mode
    , step
    , reached
    , node
    , MIN(node_order) AS node_order
    , SUM(weight) AS weight
    , COUNT(DISTINCT member_id) AS customers
    , SUM(weight * is_multi) AS multi_weight
    , SUM(weight * order_amount) AS amount
  FROM f
  GROUP BY dimension, mode, step, reached, node
)
, dm AS (
  SELECT DISTINCT dimension, mode FROM f
)
, fin AS (
  SELECT
    dm.dimension
    , dm.mode
    , ${frequency_sankey.max_steps} + 1 AS step
    , 1 AS reached
    , z.final_node AS node
    , MIN(z.final_order) AS node_order
    , CAST(COUNT(*) AS DOUBLE) AS weight
    , COUNT(*) AS customers
    , 0e0 AS multi_weight
    , SUM(z.cum_amount) AS amount
  FROM gp_freq_final z
  CROSS JOIN dm
  GROUP BY dm.dimension, dm.mode, z.final_node
)
, u AS (
  SELECT * FROM steps
  UNION ALL
  SELECT * FROM fin
)
SELECT
  u.*
  , CASE u.dimension
      WHEN 'category' THEN '商品カテゴリ'
      WHEN 'brand' THEN 'ブランド'
      WHEN 'amount_band' THEN '1注文の金額'
      WHEN 'channel' THEN '購入チャネル'
      ELSE '${frequency_sankey.custom_label}'
    END AS dimension_label
FROM u
