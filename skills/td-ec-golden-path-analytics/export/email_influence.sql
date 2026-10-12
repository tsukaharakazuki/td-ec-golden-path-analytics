-- ダッシュボード: Q3 メール → 商品閲覧 → 同一商品購入（メール別）
SELECT * FROM {{database}}.gp_email_influence ORDER BY sessions DESC LIMIT 300
