-- ダッシュボード: フリークエンシー・サンキーの列ごとの値（人数・複数購入の比率・金額）
SELECT * FROM {{database}}.gp_freq_nodes ORDER BY dimension, mode, step, node_order LIMIT 20000
