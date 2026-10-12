-- gp_funnel_summary: 購買サイクルのファネル（最初の流入チャネル別 ＋ 全体）
--   persons     : 流入（期間内に訪問）
--   browsed     : 回遊（${journey.browse_min_pv} PV 以上 または 商品詳細を閲覧）
--   members     : 会員（会員IDで識別できた人物）
--   registered  : 期間内に会員登録
--   purchased   : 購買（Web CV ＋ 会員の POS 購買）
--   revisited   : 初回購買後 ${journey.revisit_window_days} 日以内に再訪問
--   repurchased : 初回購買後 ${journey.repurchase_window_days} 日以内に再購入
SELECT
  CASE WHEN GROUPING(first_channel) = 1 THEN '(全体)' ELSE first_channel END AS first_channel
  , COUNT(*) AS persons
  , SUM(is_browsed) AS browsed
  , SUM(is_member) AS members
  , SUM(registered_in_window) AS registered
  , SUM(purchased) AS purchased
  , SUM(revisited) AS revisited
  , SUM(repurchased) AS repurchased
  , SUM(CASE WHEN registered_in_window = 1 AND purchased = 1 THEN 1 ELSE 0 END) AS registered_and_purchased
  , approx_percentile(days_visit_to_purchase, 0.5e0) AS median_days_to_purchase
FROM gp_lifecycle
GROUP BY GROUPING SETS ((first_channel), ())
