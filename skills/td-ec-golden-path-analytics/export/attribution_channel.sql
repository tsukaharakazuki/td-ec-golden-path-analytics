-- ダッシュボード: チャネル別アトリビューション（5モデル）
SELECT * FROM {{database}}.gp_attribution_channel ORDER BY conv_linear DESC
