-- ダッシュボード: Q1 ロイヤル／それ以外の行動指標
SELECT * FROM {{database}}.gp_loyal_behavior_stats ORDER BY product_group, customer_type
