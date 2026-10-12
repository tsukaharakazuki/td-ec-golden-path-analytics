-- gp_attribution_credits: コンバージョンごとの経路（最大 ${attribution.max_generations} 世代）と各モデルの貢献度
--   世代 = 集約後のタッチ（gp_touchpoints）。古い順に generation = 1..n_gen
--   遡り範囲: CV の ${attribution.lookback_days} 日前まで。reset_after_conversion なら前回 CV より後のみ
--   モデル:
--     first  : 最初のタッチに 1
--     last   : 最後のタッチに 1
--     linear : 1 / n_gen
--     decay  : 2^(-(CV までの日数) / 半減期) を CV 内で正規化
--     u      : 最初 ${attribution.u_first} / 最後 ${attribution.u_last} / 残りを中間で均等割（1世代=1、2世代=0.5ずつ）
WITH cv AS (
  SELECT cv_id, person_key, member_id, cv_time, prev_cv_time, COALESCE(revenue, 0) AS revenue, is_new_customer
  FROM gp_conversions
)
, win AS (
  SELECT
    cv.cv_id
    , cv.person_key
    , cv.member_id
    , cv.cv_time
    , cv.revenue
    , cv.is_new_customer
    , t.session_id
    , t.touch_time
    , t.hit_seq
    , t.touch_type
    , t.source
    , t.medium
    , t.campaign
    , t.content
    , t.channel
    , t.touch_key
    , t.landing_page_type
    , ROW_NUMBER() OVER (PARTITION BY cv.cv_id ORDER BY t.hit_seq DESC) AS rev_pos
  FROM cv
  JOIN gp_touchpoints t
    ON t.person_key = cv.person_key
   AND t.touch_time <= cv.cv_time
   AND t.touch_time > cv.cv_time - ${attribution.lookback_days} * 86400
   AND (
     NOT ${attribution.reset_after_conversion}
     OR cv.prev_cv_time IS NULL
     OR t.touch_time > cv.prev_cv_time
   )
)
, kept AS (
  SELECT
    w.*
    , COUNT(*) OVER (PARTITION BY w.cv_id) AS n_gen
  FROM win w
  WHERE w.rev_pos <= ${attribution.max_generations}
)
, weighted AS (
  SELECT
    k.*
    , k.n_gen - k.rev_pos + 1 AS generation
    , power(0.5e0, (k.cv_time - k.touch_time) / 86400.0e0 / ${attribution.decay_half_life_days}) AS decay_w
  FROM kept k
)
, credited AS (
  SELECT
    w.cv_id, w.person_key, w.member_id, w.cv_time, w.revenue, w.is_new_customer
    , w.session_id, w.touch_time, w.touch_type, w.source, w.medium, w.campaign, w.content
    , w.channel, w.touch_key, w.landing_page_type
    , w.generation
    , w.n_gen
    , (w.cv_time - w.touch_time) / 86400.0e0 AS days_before_cv
    , CASE WHEN w.generation = 1 THEN 1.0e0 ELSE 0.0e0 END AS credit_first
    , CASE WHEN w.generation = w.n_gen THEN 1.0e0 ELSE 0.0e0 END AS credit_last
    , 1.0e0 / w.n_gen AS credit_linear
    , w.decay_w / SUM(w.decay_w) OVER (PARTITION BY w.cv_id) AS credit_decay
    , CASE
        WHEN w.n_gen = 1 THEN 1.0e0
        WHEN w.n_gen = 2 THEN 0.5e0
        WHEN w.generation = 1 THEN CAST(${attribution.u_first} AS DOUBLE)
        WHEN w.generation = w.n_gen THEN CAST(${attribution.u_last} AS DOUBLE)
        ELSE (1.0e0 - CAST(${attribution.u_first} AS DOUBLE) - CAST(${attribution.u_last} AS DOUBLE)) / (w.n_gen - 2)
      END AS credit_u
  FROM weighted w
)
, no_touch AS (
  SELECT
    cv.cv_id, cv.person_key, cv.member_id, cv.cv_time, cv.revenue, cv.is_new_customer
    , CAST(NULL AS VARCHAR) AS session_id
    , CAST(NULL AS BIGINT) AS touch_time
    , CAST(NULL AS VARCHAR) AS touch_type
    , '(none)' AS source, '(none)' AS medium, '(none)' AS campaign, '(none)' AS content
    , '(no touch)' AS channel, '(no touch)' AS touch_key
    , CAST(NULL AS VARCHAR) AS landing_page_type
    , 1 AS generation
    , 1 AS n_gen
    , CAST(NULL AS DOUBLE) AS days_before_cv
    , 1.0e0 AS credit_first, 1.0e0 AS credit_last, 1.0e0 AS credit_linear, 1.0e0 AS credit_decay, 1.0e0 AS credit_u
  FROM cv
  LEFT JOIN (SELECT DISTINCT cv_id FROM credited) c ON c.cv_id = cv.cv_id
  WHERE c.cv_id IS NULL
)
SELECT * FROM credited
UNION ALL
SELECT * FROM no_touch
