-- ダッシュボード: フリークエンシー・サンキーの帯（軸 × 見せ方 × 購入回数 × 前後の値）
SELECT * FROM {{database}}.gp_freq_links ORDER BY dimension, mode, step, kind, weight DESC LIMIT 50000
