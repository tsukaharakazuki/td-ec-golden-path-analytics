-- gp_lifecycle: 人物ごとの購買サイクル（流入 → 回遊 → 会員登録 → 購買 → 再訪問 → 再購入）
--   対象: 集計期間内に Web 訪問があった人物
--   購買: Web の購入完了 ＋（会員なら）POS の購入（店舗含む）。注文IDで重複排除
WITH period AS (
  SELECT
    TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') AS end_time
    , TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') - ${common.weblog_lookback_days} * 86400 AS start_time
)
, p AS (
  SELECT
    person_key
    , MAX(member_id) AS member_id
    , MIN(session_start) AS first_visit_time
    , COUNT(*) AS sessions
    , SUM(pv) AS pv
    , SUM(product_views) AS pdp_views
  FROM gp_sessions
  GROUP BY person_key
)
, ft AS (
  SELECT
    person_key
    , min_by(channel, hit_seq) AS first_channel
    , min_by(touch_key, hit_seq) AS first_touch_key
  FROM gp_touchpoints
  GROUP BY person_key
)
, web_reg AS (
  SELECT person_key, MIN(time) AS web_register_time
  FROM gp_hits
  WHERE page_type = 'register'
  GROUP BY person_key
)
, purchases_raw AS (
  SELECT person_key, cv_time AS purchase_time, order_id, 'ec' AS channel
  FROM gp_conversions
  UNION ALL
  SELECT p.person_key, o.order_time AS purchase_time, o.order_id, o.channel
  FROM gp_orders o
  JOIN p ON p.member_id = o.member_id
  CROSS JOIN period pr
  WHERE o.order_time >= pr.start_time
)
, purchases AS (
  SELECT
    person_key
    , MIN(purchase_time) AS purchase_time
    , MAX(channel) AS channel
  FROM purchases_raw
  GROUP BY person_key, COALESCE(order_id, CAST(purchase_time AS VARCHAR))
)
, ranked AS (
  SELECT
    person_key
    , purchase_time
    , channel
    , ROW_NUMBER() OVER (PARTITION BY person_key ORDER BY purchase_time) AS rn
  FROM purchases
)
, first_purchase AS (
  SELECT person_key, purchase_time AS first_purchase_time, channel AS first_purchase_channel
  FROM ranked
  WHERE rn = 1
)
, second_purchase AS (
  SELECT r.person_key, MIN(r.purchase_time) AS second_purchase_time
  FROM ranked r
  JOIN first_purchase f ON f.person_key = r.person_key
  WHERE r.purchase_time > f.first_purchase_time + 86400
    AND r.purchase_time <= f.first_purchase_time + ${journey.repurchase_window_days} * 86400
  GROUP BY r.person_key
)
, revisit AS (
  SELECT s.person_key, MIN(s.session_start) AS revisit_time
  FROM gp_sessions s
  JOIN first_purchase f ON f.person_key = s.person_key
  WHERE s.session_start > f.first_purchase_time + 3600
    AND s.session_start <= f.first_purchase_time + ${journey.revisit_window_days} * 86400
  GROUP BY s.person_key
)
SELECT
  p.person_key
  , p.member_id
  , CASE WHEN p.member_id IS NOT NULL THEN 1 ELSE 0 END AS is_member
  , p.first_visit_time
  , COALESCE(ft.first_channel, '(no touch)') AS first_channel
  , COALESCE(ft.first_touch_key, '(no touch)') AS first_touch_key
  , p.sessions
  , p.pv
  , p.pdp_views
  , CASE WHEN p.pv >= ${journey.browse_min_pv} OR p.pdp_views > 0 THEN 1 ELSE 0 END AS is_browsed
  , COALESCE(m.register_time, wr.web_register_time) AS register_time
  , CASE
      WHEN COALESCE(m.register_time, wr.web_register_time) >= pr.start_time THEN 1
      ELSE 0
    END AS registered_in_window
  , fp.first_purchase_time
  , fp.first_purchase_channel
  , CASE WHEN fp.first_purchase_time IS NOT NULL THEN 1 ELSE 0 END AS purchased
  , CASE WHEN rv.revisit_time IS NOT NULL THEN 1 ELSE 0 END AS revisited
  , sp.second_purchase_time
  , CASE WHEN sp.second_purchase_time IS NOT NULL THEN 1 ELSE 0 END AS repurchased
  , CASE
      WHEN fp.first_purchase_time IS NOT NULL THEN (fp.first_purchase_time - p.first_visit_time) / 86400.0e0
    END AS days_visit_to_purchase
  , rc.segment
  , rc.is_loyal
FROM p
CROSS JOIN period pr
LEFT JOIN ft ON ft.person_key = p.person_key
LEFT JOIN web_reg wr ON wr.person_key = p.person_key
LEFT JOIN gp_members m ON m.member_id = p.member_id
LEFT JOIN first_purchase fp ON fp.person_key = p.person_key
LEFT JOIN second_purchase sp ON sp.person_key = p.person_key
LEFT JOIN revisit rv ON rv.person_key = p.person_key
LEFT JOIN gp_rfm_customer rc ON rc.member_id = p.member_id
