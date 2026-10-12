-- gp_email_view_purchase (Q3): メール経由セッションで閲覧した商品と、その同一商品の購入
--   1行 = メール（touch_key）× 人物 × 閲覧商品
--   同一商品購入: 閲覧から ${email.same_product_window_days} 日以内に、同じ商品IDを購入（Web CV の購入商品、または会員の POS 明細＝店舗含む）
--   別商品購入: 同じ期間に、閲覧商品以外を購入
WITH email_sessions AS (
  SELECT session_id, person_key, member_id, entry_touch_key, entry_source, entry_medium, entry_campaign
  FROM gp_sessions
  WHERE regexp_like(entry_medium, '${email.medium_regex}')
     OR regexp_like(entry_source, '${email.source_regex}')
)
, vp AS (
  SELECT
    es.entry_touch_key AS email_key
    , MAX(es.entry_source) AS source
    , MAX(es.entry_campaign) AS campaign
    , es.person_key
    , MAX(es.member_id) AS member_id
    , h.product_id
    , MIN(h.time) AS view_time
    , COUNT(*) AS views
    , COUNT(DISTINCT es.session_id) AS sessions
  FROM email_sessions es
  JOIN gp_hits h ON h.session_id = es.session_id
  WHERE h.page_type = 'pdp'
    AND h.product_id IS NOT NULL
  GROUP BY es.entry_touch_key, es.person_key, h.product_id
)
, purchases AS (
  SELECT
    c.person_key
    , CAST(NULL AS VARCHAR) AS member_id
    , i.product_id
    , i.cv_time AS purchase_time
    , 'ec' AS channel
    , COALESCE(i.amount, 0) AS amount
    , COALESCE(c.order_id, c.cv_id) AS order_key
  FROM gp_cv_items i
  JOIN gp_conversions c ON c.cv_id = i.cv_id
  UNION ALL
  SELECT
    CAST(NULL AS VARCHAR) AS person_key
    , l.member_id
    , l.product_id
    , l.order_time AS purchase_time
    , l.channel
    , COALESCE(l.amount, 0) AS amount
    , l.order_id AS order_key
  FROM gp_order_lines l
  WHERE l.member_id IS NOT NULL
)
, matched AS (
  SELECT v.email_key, v.person_key, v.product_id AS viewed_product_id, p.product_id, p.purchase_time, p.channel, p.amount, p.order_key
  FROM vp v
  JOIN purchases p
    ON p.person_key = v.person_key
   AND p.purchase_time >= v.view_time
   AND p.purchase_time <= v.view_time + ${email.same_product_window_days} * 86400
  UNION ALL
  SELECT v.email_key, v.person_key, v.product_id AS viewed_product_id, p.product_id, p.purchase_time, p.channel, p.amount, p.order_key
  FROM vp v
  JOIN purchases p
    ON v.member_id IS NOT NULL
   AND p.member_id = v.member_id
   AND p.purchase_time >= v.view_time
   AND p.purchase_time <= v.view_time + ${email.same_product_window_days} * 86400
)
, dedup AS (
  -- Web の購入完了と POS の EC 注文が同じ注文の場合は1件に
  SELECT
    email_key
    , person_key
    , viewed_product_id
    , product_id
    , order_key
    , MIN(purchase_time) AS purchase_time
    , MAX(CASE WHEN channel = 'ec' THEN 'ec' ELSE channel END) AS channel
    , MAX(amount) AS amount
  FROM matched
  GROUP BY 1, 2, 3, 4, 5
)
, agg AS (
  SELECT
    email_key
    , person_key
    , viewed_product_id
    , MIN(CASE WHEN product_id = viewed_product_id THEN purchase_time END) AS same_purchase_time
    , min_by(channel, CASE WHEN product_id = viewed_product_id THEN purchase_time END) AS same_purchase_channel
    , SUM(CASE WHEN product_id = viewed_product_id THEN amount ELSE 0 END) AS same_revenue
    , SUM(CASE WHEN product_id = viewed_product_id AND channel <> 'ec' THEN amount ELSE 0 END) AS same_store_revenue
    , MAX(CASE WHEN product_id <> viewed_product_id THEN 1 ELSE 0 END) AS purchased_other
    , SUM(CASE WHEN product_id <> viewed_product_id THEN amount ELSE 0 END) AS other_revenue
  FROM dedup
  GROUP BY 1, 2, 3
)
SELECT
  v.email_key
  , v.source
  , v.campaign
  , v.person_key
  , v.member_id
  , v.product_id
  , v.view_time
  , v.views
  , v.sessions
  , CASE WHEN a.same_purchase_time IS NOT NULL THEN 1 ELSE 0 END AS purchased_same
  , a.same_purchase_time
  , (a.same_purchase_time - v.view_time) / 86400.0e0 AS days_to_same_purchase
  , a.same_purchase_channel
  , COALESCE(a.same_revenue, 0) AS same_revenue
  , COALESCE(a.same_store_revenue, 0) AS same_store_revenue
  , COALESCE(a.purchased_other, 0) AS purchased_other
  , COALESCE(a.other_revenue, 0) AS other_revenue
FROM vp v
LEFT JOIN agg a
  ON a.email_key = v.email_key
 AND a.person_key = v.person_key
 AND a.viewed_product_id = v.product_id
