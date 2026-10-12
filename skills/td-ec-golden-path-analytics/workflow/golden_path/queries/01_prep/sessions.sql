-- gp_sessions: セッション単位の行動サマリーと「サイト内行動パターン」
--   behavior_signature: セッション内（購入完了より前）のページ種別の並び。
--   同じページ種別の連続は1ステップにまとめ、回数を ×2 / ×3+ で表す。例: "top > search > pdp×3+"
--   golden_path.behavior_exclude_regex に一致するページ種別（既定: cart / checkout）は含めない。
--   購入直前に必ず通るページを含めると、行動パターンの CVR が見かけ上高くなるため。
WITH cv_pos AS (
  SELECT session_id, MIN(hit_seq) AS first_cv_seq
  FROM gp_hits
  WHERE is_cv_hit = 1
  GROUP BY session_id
)
, pre AS (
  SELECT h.session_id, h.hit_seq, h.page_type
  FROM gp_hits h
  LEFT JOIN cv_pos c ON c.session_id = h.session_id
  WHERE (c.first_cv_seq IS NULL OR h.hit_seq < c.first_cv_seq)
    AND NOT regexp_like(h.page_type, '${golden_path.behavior_exclude_regex}')
)
, runs AS (
  SELECT
    p.*
    , CASE
        WHEN p.page_type = LAG(p.page_type) OVER (PARTITION BY p.session_id ORDER BY p.hit_seq) THEN 0
        ELSE 1
      END AS is_new_run
  FROM pre p
)
, runs2 AS (
  SELECT
    r.*
    , SUM(r.is_new_run) OVER (
        PARTITION BY r.session_id ORDER BY r.hit_seq
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS run_id
  FROM runs r
)
, run_grp AS (
  SELECT
    session_id
    , run_id
    , MAX(page_type) AS page_type
    , COUNT(*) AS cnt
  FROM runs2
  GROUP BY session_id, run_id
)
, sig AS (
  SELECT
    session_id
    , array_join(
        array_agg(
          CASE WHEN run_id <= ${golden_path.behavior_steps} THEN
            page_type || CASE WHEN cnt >= 3 THEN '×3+' WHEN cnt = 2 THEN '×2' ELSE '' END
          END
          ORDER BY run_id
        ),
        ' > '
      ) || CASE WHEN MAX(run_id) > ${golden_path.behavior_steps} THEN ' > …' ELSE '' END AS behavior_signature
    , MAX(run_id) AS behavior_steps
  FROM run_grp
  GROUP BY session_id
)
, agg AS (
  SELECT
    h.session_id
    , h.person_key
    , MAX(h.member_id) AS member_id
    , MAX(h.cookie) AS cookie
    , MIN(h.time) AS session_start
    , MAX(h.time) AS session_end
    , COUNT(*) AS pv
    , COUNT_IF(h.page_type = 'pdp') AS product_views
    , COUNT(DISTINCT h.product_id) AS distinct_products
    , MAX(CASE WHEN h.page_type = 'search' THEN 1 ELSE 0 END) AS has_search
    , MAX(CASE WHEN h.page_type = 'cart' THEN 1 ELSE 0 END) AS has_cart
    , MAX(CASE WHEN h.page_type = 'register' THEN 1 ELSE 0 END) AS has_register
    , MAX(CASE WHEN h.page_type = 'content' THEN 1 ELSE 0 END) AS has_content
    , COUNT_IF(h.is_cv_hit = 1) AS cv_hits
    , MAX(h.is_mobile) AS is_mobile
    , min_by(h.page_type, h.hit_seq) AS landing_page_type
    , min_by(h.path_query, h.hit_seq) AS landing_path
    , min_by(h.t_source, CASE WHEN h.touch_type IS NOT NULL THEN h.hit_seq END) AS entry_source
    , min_by(h.t_medium, CASE WHEN h.touch_type IS NOT NULL THEN h.hit_seq END) AS entry_medium
    , min_by(h.t_campaign, CASE WHEN h.touch_type IS NOT NULL THEN h.hit_seq END) AS entry_campaign
    , min_by(h.t_content, CASE WHEN h.touch_type IS NOT NULL THEN h.hit_seq END) AS entry_content
  FROM gp_hits h
  GROUP BY h.session_id, h.person_key
)
SELECT
  a.session_id
  , a.person_key
  , a.member_id
  , a.cookie
  , a.session_start
  , a.session_end
  , a.session_end - a.session_start AS duration_sec
  , a.pv
  , a.product_views
  , a.distinct_products
  , a.has_search
  , a.has_cart
  , a.has_register
  , a.has_content
  , CASE WHEN a.cv_hits > 0 THEN 1 ELSE 0 END AS has_cv
  , a.is_mobile
  , a.landing_page_type
  , a.landing_path
  , COALESCE(a.entry_source, '(none)') AS entry_source
  , COALESCE(a.entry_medium, '(none)') AS entry_medium
  , COALESCE(a.entry_campaign, '(none)') AS entry_campaign
  , COALESCE(d.channel, '(no touch)') AS entry_channel
  , COALESCE(d.touch_key, '(no touch)') AS entry_touch_key
  , COALESCE(s.behavior_signature, a.landing_page_type) AS behavior_signature
  , COALESCE(s.behavior_steps, 0) AS behavior_steps
FROM agg a
LEFT JOIN sig s ON s.session_id = a.session_id
LEFT JOIN gp_touch_dim d
  ON d.t_source = a.entry_source
 AND d.t_medium = a.entry_medium
 AND d.t_campaign = a.entry_campaign
 AND d.t_content = a.entry_content
