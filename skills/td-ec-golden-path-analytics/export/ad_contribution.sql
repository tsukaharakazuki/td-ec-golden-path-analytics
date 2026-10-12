-- ダッシュボード: Q2 広告の購買貢献
SELECT * FROM {{database}}.gp_ad_contribution ORDER BY conv_linear DESC LIMIT 300
