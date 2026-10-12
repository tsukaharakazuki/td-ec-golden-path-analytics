-- ダッシュボード: touch_key 別アトリビューション（5モデル、上位 300）
SELECT * FROM {{database}}.gp_attribution_summary ORDER BY conv_linear DESC LIMIT 300
