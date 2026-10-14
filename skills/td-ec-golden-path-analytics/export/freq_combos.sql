-- ダッシュボード: 1注文で複数の値を買ったときの組み合わせ（購入回数・軸ごとの上位 20）
SELECT * FROM {{database}}.gp_freq_combos ORDER BY dimension, step, rnk LIMIT 5000
