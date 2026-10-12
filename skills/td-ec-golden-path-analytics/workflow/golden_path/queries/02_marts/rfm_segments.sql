-- gp_rfm_segments: RFM セグメント × 会員属性（性別・年代）× 購買チャネル
SELECT
  c.segment
  , c.channel_mix
  , COALESCE(m.gender, '(不明)') AS gender
  , COALESCE(m.age_band, '(不明)') AS age_band
  , COUNT(*) AS customers
  , SUM(c.monetary) AS revenue
  , SUM(c.frequency) AS orders
  , SUM(c.ec_monetary) AS ec_revenue
  , SUM(c.is_loyal) AS loyal_customers
FROM gp_rfm_customer c
LEFT JOIN gp_members m ON m.member_id = c.member_id
GROUP BY 1, 2, 3, 4
