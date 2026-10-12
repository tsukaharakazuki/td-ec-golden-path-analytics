-- ダッシュボード: Q1 ロイヤル顧客の商品グループ別 流入経路・サイト内行動
SELECT * FROM {{database}}.gp_loyal_product_paths ORDER BY product_group, dimension, rank_in_group
