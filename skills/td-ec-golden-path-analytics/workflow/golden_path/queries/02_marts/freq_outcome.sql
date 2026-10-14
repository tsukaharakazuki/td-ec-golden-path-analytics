-- gp_freq_outcome: F<step> で買った値ごとの、最終列（累計購買金額ランクなど）の構成
--   「F1 でどの商品から入った人が、F<max_steps> 後に上位ランクになりやすいか」を見る
--   対象は F<max_steps> まで購入した人。weight は人数（split では人相当）
SELECT
  f.dimension
  , f.mode
  , f.step
  , f.node
  , MIN(f.node_order) AS node_order
  , z.final_node
  , MIN(z.final_order) AS final_order
  , SUM(f.weight) AS weight
  , COUNT(DISTINCT f.member_id) AS customers
FROM gp_freq_orders f
JOIN gp_freq_final z ON z.member_id = f.member_id
WHERE f.reached = 1
GROUP BY f.dimension, f.mode, f.step, f.node, z.final_node
