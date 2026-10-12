-- gp_cv_journey: コンバージョン1件ごとの「流入経路 × サイト内行動 × 購入商品 × 顧客」
--   channel_path : 世代を古い順に並べたチャネル列（同じチャネルの連続は1つにまとめる）
--   path_pattern : channel_path の直近 ${golden_path.path_steps} ステップ（ゴールデンパスの単位）
--   behavior_signature : 購入したセッションのサイト内行動パターン（gp_sessions）
--   is_loyal / segment : 現在の RFM（gp_rfm_customer）
--   repurchased : ${journey.repurchase_window_days} 日以内に再購入（Web CV または POS）。repeat_eligible = 判定に必要な日数が経過済み
WITH steps AS (
  SELECT
    cv_id
    , generation
    , channel
    , LAG(channel) OVER (PARTITION BY cv_id ORDER BY generation) AS prev_channel
  FROM gp_attribution_credits
)
, dedup_steps AS (
  SELECT
    cv_id
    , generation
    , channel
    , ROW_NUMBER() OVER (PARTITION BY cv_id ORDER BY generation DESC) AS rev_step
    , COUNT(*) OVER (PARTITION BY cv_id) AS n_steps
  FROM steps
  WHERE prev_channel IS NULL OR prev_channel <> channel
)
, paths AS (
  SELECT
    cv_id
    , array_join(array_agg(channel ORDER BY generation), ' > ') AS channel_path
    , CASE WHEN MAX(n_steps) > ${golden_path.path_steps} THEN '… > ' ELSE '' END
      || array_join(
           array_agg(CASE WHEN rev_step <= ${golden_path.path_steps} THEN channel END ORDER BY generation),
           ' > '
         ) AS path_pattern
    , MAX(n_steps) AS channel_steps
    , min_by(channel, generation) AS first_channel
    , max_by(channel, generation) AS last_channel
  FROM dedup_steps
  GROUP BY cv_id
)
, gen AS (
  SELECT
    cv_id
    , MAX(n_gen) AS n_gen
    , MIN(touch_time) AS first_touch_time
    , MAX(CASE WHEN regexp_like(COALESCE(medium, ''), '${email.medium_regex}') OR regexp_like(COALESCE(source, ''), '${email.source_regex}') THEN 1 ELSE 0 END) AS has_email_touch
    , MAX(CASE WHEN regexp_like(COALESCE(medium, ''), '${ads.paid_medium_regex}') OR regexp_like(channel, '${ads.paid_channel_regex}') THEN 1 ELSE 0 END) AS has_paid_touch
  FROM gp_attribution_credits
  GROUP BY cv_id
)
, cvb AS (
  SELECT
    c.*
    , COALESCE(g.first_touch_time, c.cv_time) AS first_touch_time
    , COALESCE(g.n_gen, 0) AS n_gen
    , COALESCE(g.has_email_touch, 0) AS has_email_touch
    , COALESCE(g.has_paid_touch, 0) AS has_paid_touch
  FROM gp_conversions c
  LEFT JOIN gen g ON g.cv_id = c.cv_id
)
, pre_sessions AS (
  SELECT
    c.cv_id
    , COUNT(*) AS sessions_to_cv
    , SUM(s.product_views) AS pdp_views_to_cv
    , MAX(s.has_search) AS used_search
    , MAX(s.has_content) AS used_content
  FROM cvb c
  JOIN gp_sessions s
    ON s.person_key = c.person_key
   AND s.session_start >= c.first_touch_time - ${touch.session_timeout_minutes} * 60
   AND s.session_start <= c.cv_time
  GROUP BY c.cv_id
)
, items AS (
  SELECT
    cv_id
    , CASE '${golden_path.product_level}'
        WHEN 'brand' THEN brand
        WHEN 'product' THEN COALESCE(product_name, product_id)
        ELSE category
      END AS product_group
    , SUM(COALESCE(amount, 0)) AS amount
    , SUM(quantity) AS quantity
  FROM gp_cv_items
  GROUP BY 1, 2
)
, main_item AS (
  SELECT
    cv_id
    , max_by(product_group, amount) AS main_product_group
    , COUNT(*) AS product_groups
    , SUM(amount) AS items_amount
    , SUM(quantity) AS items_quantity
  FROM items
  GROUP BY cv_id
)
, rep_web AS (
  SELECT c.cv_id
  FROM cvb c
  JOIN gp_conversions l
    ON l.person_key = c.person_key
   AND l.cv_time > c.cv_time + 86400
   AND l.cv_time <= c.cv_time + ${journey.repurchase_window_days} * 86400
)
, rep_pos AS (
  SELECT c.cv_id
  FROM cvb c
  JOIN gp_orders o
    ON o.member_id = c.member_id
   AND o.order_time > c.cv_time + 86400
   AND o.order_time <= c.cv_time + ${journey.repurchase_window_days} * 86400
   AND (c.order_id IS NULL OR o.order_id <> c.order_id)
  WHERE c.member_id IS NOT NULL
)
, repeat_flag AS (
  SELECT cv_id, 1 AS repurchased
  FROM (
    SELECT cv_id FROM rep_web
    UNION
    SELECT cv_id FROM rep_pos
  ) u
  GROUP BY cv_id
)
SELECT
  c.cv_id
  , c.order_id
  , c.person_key
  , c.member_id
  , c.cv_time
  , COALESCE(c.revenue, mi.items_amount, 0) AS revenue
  , c.is_new_customer
  , c.n_gen
  , COALESCE(p.channel_path, '(no touch)') AS channel_path
  , COALESCE(p.path_pattern, '(no touch)') AS path_pattern
  , COALESCE(p.channel_steps, 0) AS channel_steps
  , COALESCE(p.first_channel, '(no touch)') AS first_channel
  , COALESCE(p.last_channel, '(no touch)') AS last_channel
  , c.has_email_touch
  , c.has_paid_touch
  , (c.cv_time - c.first_touch_time) / 86400.0e0 AS days_to_cv
  , COALESCE(ps.sessions_to_cv, 1) AS sessions_to_cv
  , COALESCE(ps.pdp_views_to_cv, 0) AS pdp_views_to_cv
  , COALESCE(ps.used_search, 0) AS used_search
  , COALESCE(ps.used_content, 0) AS used_content
  , s.behavior_signature
  , s.landing_page_type
  , s.entry_channel AS cv_session_channel
  , s.is_mobile
  , COALESCE(mi.main_product_group, '(不明)') AS main_product_group
  , COALESCE(mi.product_groups, 0) AS product_groups
  , r.segment
  , r.rfm_cell
  , CASE WHEN c.member_id IS NULL OR r.member_id IS NULL THEN CAST(NULL AS INTEGER) ELSE r.is_loyal END AS is_loyal
  , COALESCE(rf.repurchased, 0) AS repurchased
  , CASE
      WHEN c.cv_time <= TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') - ${journey.repurchase_window_days} * 86400 THEN 1
      ELSE 0
    END AS repeat_eligible
FROM cvb c
LEFT JOIN paths p ON p.cv_id = c.cv_id
LEFT JOIN pre_sessions ps ON ps.cv_id = c.cv_id
LEFT JOIN gp_sessions s ON s.session_id = c.session_id
LEFT JOIN main_item mi ON mi.cv_id = c.cv_id
LEFT JOIN gp_rfm_customer r ON r.member_id = c.member_id
LEFT JOIN repeat_flag rf ON rf.cv_id = c.cv_id
