-- ダッシュボード: RFM セグメント × 性別・年代・購買チャネル
SELECT * FROM {{database}}.gp_rfm_segments ORDER BY customers DESC LIMIT 2000
