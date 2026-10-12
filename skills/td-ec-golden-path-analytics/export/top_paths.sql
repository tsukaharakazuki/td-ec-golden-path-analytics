-- ダッシュボード: よく出現するコンバージョン経路（上位 50）
SELECT * FROM {{database}}.gp_top_paths ORDER BY conversions DESC LIMIT 50
