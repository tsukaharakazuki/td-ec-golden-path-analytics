-- ダッシュボード: 何回目に何を買った人が、最終列（累計購買金額ランクなど）のどこに着いたか
SELECT * FROM {{database}}.gp_freq_outcome ORDER BY dimension, mode, step, node_order, final_order LIMIT 50000
