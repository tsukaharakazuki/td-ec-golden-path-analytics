-- gp_touchpoints: 流入タッチ（集約後）
--
-- ブラウザの戻る・進む操作で、同じ utm 付き URL が再記録されることがある。
-- 例: pmax → 内部 → 内部 → pmax（戻る）
-- 内部遷移を挟んで同じ touch_key（attribution.grain の粒度）が連続した場合は、
-- touch.collapse_mode に従って1世代に集約する。
--   session: 同一セッション内の連続のみ集約（既定）
--   always : セッションをまたいでも連続していれば集約
--   none   : 集約しない
WITH t AS (
  SELECT
    h.person_key
    , h.member_id
    , h.cookie
    , h.session_id
    , h.time AS touch_time
    , h.hit_seq
    , h.touch_type
    , h.t_source AS source
    , h.t_medium AS medium
    , h.t_campaign AS campaign
    , h.t_content AS content
    , d.channel
    , d.touch_key
    , h.page_type AS landing_page_type
    , h.path_query AS landing_path
    , h.product_id AS landing_product_id
  FROM gp_hits h
  JOIN gp_touch_dim d
    ON d.t_source = h.t_source
   AND d.t_medium = h.t_medium
   AND d.t_campaign = h.t_campaign
   AND d.t_content = h.t_content
  WHERE h.touch_type IS NOT NULL
)
, l AS (
  SELECT
    t.*
    , LAG(t.touch_key) OVER (PARTITION BY t.person_key ORDER BY t.hit_seq) AS prev_key
    , LAG(t.session_id) OVER (PARTITION BY t.person_key ORDER BY t.hit_seq) AS prev_session
  FROM t
)
, kept AS (
  SELECT *
  FROM l
  WHERE prev_key IS NULL
     OR prev_key <> touch_key
     OR '${touch.collapse_mode}' = 'none'
     OR ('${touch.collapse_mode}' = 'session' AND prev_session <> session_id)
)
SELECT
  k.person_key
  , k.member_id
  , k.cookie
  , k.session_id
  , k.touch_time
  , k.hit_seq
  , ROW_NUMBER() OVER (PARTITION BY k.person_key ORDER BY k.hit_seq) AS touch_seq
  , k.touch_type
  , k.source
  , k.medium
  , k.campaign
  , k.content
  , k.channel
  , k.touch_key
  , k.landing_page_type
  , k.landing_path
  , k.landing_product_id
FROM kept k
