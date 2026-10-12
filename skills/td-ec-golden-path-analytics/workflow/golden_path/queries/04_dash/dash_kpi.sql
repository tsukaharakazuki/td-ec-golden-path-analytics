-- gp_dash_kpi: ダッシュボードの KPI とデータ品質の指標（1行）
WITH period AS (
  SELECT
    TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') AS end_time
    , TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') - ${common.weblog_lookback_days} * 86400 AS start_time
)
, h AS (
  SELECT
    COUNT(*) AS hits
    , COUNT(DISTINCT cookie) AS cookies
    , COUNT(DISTINCT person_key) AS persons
    , COUNT(DISTINCT member_id) AS members_seen
    , COUNT_IF(touch_type IS NOT NULL) AS raw_touches
    , COUNT_IF(has_utm = 1) AS utm_hits
    , COUNT_IF(is_excluded_ref = 1) AS excluded_referrer_hits
    , COUNT_IF(is_excluded_hit = 1) AS excluded_hits
    , COUNT_IF(is_cv_hit = 1) AS cv_hits
    , COUNT_IF(page_type = 'pdp' AND product_id IS NULL) AS pdp_without_product_id
    , COUNT_IF(page_type = 'pdp') AS pdp_hits
    , COUNT_IF(page_type = 'other') AS other_page_hits
  FROM gp_hits
)
, s AS (
  SELECT COUNT(*) AS sessions, SUM(has_cv) AS cv_sessions FROM gp_sessions
)
, t AS (
  SELECT COUNT(*) AS touches FROM gp_touchpoints
)
, c AS (
  SELECT
    COUNT(*) AS conversions
    , SUM(revenue) AS revenue
    , COUNT_IF(order_id IS NOT NULL) AS cv_with_order_id
    , COUNT_IF(member_id IS NOT NULL) AS cv_with_member
    , COUNT_IF(revenue IS NULL) AS cv_without_revenue
    , SUM(is_new_customer) AS new_customer_cv
  FROM gp_conversions
)
, ci AS (
  SELECT COUNT(DISTINCT cv_id) AS cv_with_items FROM gp_cv_items
)
, nt AS (
  SELECT COUNT(DISTINCT cv_id) AS cv_without_touch FROM gp_attribution_credits WHERE channel = '(no touch)'
)
, r AS (
  SELECT
    COUNT(*) AS rfm_customers
    , SUM(is_loyal) AS loyal_customers
    , SUM(monetary) AS rfm_revenue
    , SUM(CASE WHEN is_loyal = 1 THEN monetary ELSE 0 END) AS loyal_revenue
  FROM gp_rfm_customer
)
, o AS (
  SELECT
    COUNT(*) AS pos_orders
    , SUM(amount) AS pos_revenue
    , SUM(CASE WHEN channel = 'ec' THEN amount ELSE 0 END) AS pos_ec_revenue
    , MIN(order_time) AS pos_from
    , MAX(order_time) AS pos_to
  FROM gp_orders
)
, m AS (
  SELECT COUNT(*) AS members_total FROM gp_members
)
SELECT
  TD_SCHEDULED_TIME() AS session_time
  , to_unixtime(now()) AS generated_at
  , period.start_time AS web_from
  , period.end_time AS web_to
  , o.pos_from
  , o.pos_to
  , h.hits
  , h.cookies
  , h.persons
  , h.members_seen
  , s.sessions
  , s.cv_sessions
  , c.conversions
  , c.revenue
  , c.revenue / NULLIF(c.conversions, 0) AS aov
  , CAST(c.conversions AS DOUBLE) / NULLIF(s.sessions, 0) AS session_cvr
  , c.new_customer_cv
  , c.cv_with_order_id
  , c.cv_with_member
  , c.cv_without_revenue
  , ci.cv_with_items
  , nt.cv_without_touch
  , h.raw_touches
  , t.touches AS collapsed_touches
  , h.raw_touches - t.touches AS collapsed_away
  , h.utm_hits
  , h.excluded_referrer_hits
  , h.excluded_hits
  , h.cv_hits
  , h.pdp_hits
  , h.pdp_without_product_id
  , h.other_page_hits
  , r.rfm_customers
  , r.loyal_customers
  , r.rfm_revenue
  , r.loyal_revenue
  , o.pos_orders
  , o.pos_revenue
  , o.pos_ec_revenue
  , m.members_total
FROM period
CROSS JOIN h
CROSS JOIN s
CROSS JOIN t
CROSS JOIN c
CROSS JOIN ci
CROSS JOIN nt
CROSS JOIN r
CROSS JOIN o
CROSS JOIN m
