-- ダッシュボード: 経路の世代数・CV までの日数の分布
SELECT * FROM {{database}}.gp_path_length ORDER BY metric, bucket_order
