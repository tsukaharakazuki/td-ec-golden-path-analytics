-- gp_golden_path_candidates: ゴールデンパスの候補とスコア
--
-- 候補の単位（pattern_type）
--   full                … 流入経路 × サイト内行動 × 商品グループ
--   acquisition_product … 流入経路 × 商品グループ
--   onsite_product      … サイト内行動 × 商品グループ
--   acquisition         … 流入経路のみ
--   onsite              … サイト内行動のみ
--
-- スコア（0〜100、50 = 全体平均並み）
--   各要素のリフト（全体平均との比）を、少数サンプルを全体平均へ縮めて（prior_strength）計算し、
--   ln(リフト) / ln(lift_cap) を -1〜1 に丸めて重み付き平均する。
--     cvr     : 経路の CVR（未 CV の経路 gp_open_journeys を分母に含む）× 行動の CVR（セッション単位）の幾何平均
--     loyalty : 購入者のうちロイヤル顧客（RFM）の比率
--     repeat  : ${journey.repurchase_window_days} 日以内の再購入率
--     value   : 1 CV あたり売上
--     support : CV 数の多さ（その種別で最大の候補を 1 とした対数スケール）
WITH base AS (
  SELECT
    cv_id
    , person_key
    , path_pattern
    , behavior_signature
    , main_product_group AS product_group
    , revenue
    , is_loyal
    , repurchased
    , repeat_eligible
  FROM gp_cv_journey
)
, baseline AS (
  SELECT
    AVG(revenue) AS aov
    , AVG(CAST(is_loyal AS DOUBLE)) AS loyal_rate
    , CAST(SUM(CASE WHEN repeat_eligible = 1 THEN repurchased ELSE 0 END) AS DOUBLE) / NULLIF(SUM(repeat_eligible), 0) AS repeat_rate
  FROM base
)
, path_cvr AS (
  SELECT path_pattern, SUM(is_cv) AS conv, SUM(1 - is_cv) AS open_paths
  FROM (
    SELECT path_pattern, 1 AS is_cv FROM gp_cv_journey
    UNION ALL
    SELECT path_pattern, 0 AS is_cv FROM gp_open_journeys
  ) u
  GROUP BY path_pattern
)
, path_base AS (
  SELECT CAST(SUM(conv) AS DOUBLE) / NULLIF(SUM(conv) + SUM(open_paths), 0) AS cvr FROM path_cvr
)
, beh_cvr AS (
  SELECT behavior_signature, COUNT(*) AS sessions, SUM(has_cv) AS cv_sessions
  FROM gp_sessions
  GROUP BY behavior_signature
)
, beh_base AS (
  SELECT CAST(SUM(cv_sessions) AS DOUBLE) / NULLIF(SUM(sessions), 0) AS cvr FROM beh_cvr
)
, cand AS (
  SELECT
    CASE GROUPING(path_pattern, behavior_signature, product_group)
      WHEN 0 THEN 'full'
      WHEN 2 THEN 'acquisition_product'
      WHEN 4 THEN 'onsite_product'
      WHEN 3 THEN 'acquisition'
      WHEN 5 THEN 'onsite'
    END AS pattern_type
    , path_pattern
    , behavior_signature
    , product_group
    , COUNT(*) AS conversions
    , COUNT(DISTINCT person_key) AS customers
    , SUM(revenue) AS revenue
    , COUNT(is_loyal) AS loyal_known
    , SUM(is_loyal) AS loyal_cv
    , SUM(repeat_eligible) AS repeat_eligible
    , SUM(CASE WHEN repeat_eligible = 1 THEN repurchased ELSE 0 END) AS repurchased
  FROM base
  GROUP BY GROUPING SETS (
    (path_pattern, behavior_signature, product_group)
    , (path_pattern, product_group)
    , (behavior_signature, product_group)
    , (path_pattern)
    , (behavior_signature)
  )
)
, metrics AS (
  SELECT
    c.*
    , pc.conv + pc.open_paths AS path_journeys
    , bc.sessions AS behavior_sessions
    , b.aov AS base_aov
    , b.loyal_rate AS base_loyal_rate
    , b.repeat_rate AS base_repeat_rate
    , pb.cvr AS base_path_cvr
    , bb.cvr AS base_behavior_cvr
    , CAST(pc.conv AS DOUBLE) / NULLIF(pc.conv + pc.open_paths, 0) AS path_cvr
    , CAST(bc.cv_sessions AS DOUBLE) / NULLIF(bc.sessions, 0) AS behavior_cvr
    , CASE WHEN c.path_pattern IS NOT NULL AND pb.cvr > 0 THEN
        ((pc.conv + ${golden_path.prior_strength} * pb.cvr) / (pc.conv + pc.open_paths + ${golden_path.prior_strength})) / pb.cvr
      END AS path_cvr_lift
    , CASE WHEN c.behavior_signature IS NOT NULL AND bb.cvr > 0 THEN
        ((bc.cv_sessions + ${golden_path.prior_strength} * bb.cvr) / (bc.sessions + ${golden_path.prior_strength})) / bb.cvr
      END AS behavior_cvr_lift
    , CASE WHEN b.loyal_rate > 0 THEN
        ((c.loyal_cv + ${golden_path.prior_strength} * b.loyal_rate) / (c.loyal_known + ${golden_path.prior_strength})) / b.loyal_rate
      END AS loyalty_lift
    , CASE WHEN b.repeat_rate > 0 THEN
        ((c.repurchased + ${golden_path.prior_strength} * b.repeat_rate) / (c.repeat_eligible + ${golden_path.prior_strength})) / b.repeat_rate
      END AS repeat_lift
    , CASE WHEN b.aov > 0 THEN
        ((c.revenue + ${golden_path.prior_strength} * b.aov) / (c.conversions + ${golden_path.prior_strength})) / b.aov
      END AS value_index
  FROM cand c
  CROSS JOIN baseline b
  CROSS JOIN path_base pb
  CROSS JOIN beh_base bb
  LEFT JOIN path_cvr pc ON pc.path_pattern = c.path_pattern
  LEFT JOIN beh_cvr bc ON bc.behavior_signature = c.behavior_signature
)
, lifted AS (
  SELECT
    m.*
    , CASE
        WHEN m.path_cvr_lift IS NOT NULL AND m.behavior_cvr_lift IS NOT NULL THEN sqrt(m.path_cvr_lift * m.behavior_cvr_lift)
        ELSE COALESCE(m.path_cvr_lift, m.behavior_cvr_lift)
      END AS cvr_lift
    , MAX(m.conversions) OVER (PARTITION BY m.pattern_type) AS max_conversions_in_type
  FROM metrics m
)
, comps AS (
  SELECT
    l.*
    , COALESCE(GREATEST(-1.0e0, LEAST(1.0e0, ln(l.cvr_lift) / ln(${golden_path.lift_cap}))), 0) AS c_cvr
    , COALESCE(GREATEST(-1.0e0, LEAST(1.0e0, ln(l.loyalty_lift) / ln(${golden_path.lift_cap}))), 0) AS c_loyalty
    , COALESCE(GREATEST(-1.0e0, LEAST(1.0e0, ln(l.repeat_lift) / ln(${golden_path.lift_cap}))), 0) AS c_repeat
    , COALESCE(GREATEST(-1.0e0, LEAST(1.0e0, ln(l.value_index) / ln(${golden_path.lift_cap}))), 0) AS c_value
    , 2.0e0 * ln(1 + l.conversions) / ln(1 + GREATEST(l.max_conversions_in_type, 1) + 0.000001e0) - 1.0e0 AS c_support
  FROM lifted l
)
SELECT
  pattern_type
  , path_pattern
  , behavior_signature
  , product_group
  , CASE
      WHEN pattern_type = 'onsite' OR pattern_type = 'onsite_product' THEN split_part(behavior_signature, ' > ', 1)
      ELSE split_part(regexp_replace(path_pattern, '^… > ', ''), ' > ', 1)
    END AS entry_key
  , conversions
  , customers
  , revenue
  , revenue / NULLIF(conversions, 0) AS revenue_per_cv
  , loyal_known
  , loyal_cv
  , CAST(loyal_cv AS DOUBLE) / NULLIF(loyal_known, 0) AS loyal_rate
  , repeat_eligible
  , repurchased
  , CAST(repurchased AS DOUBLE) / NULLIF(repeat_eligible, 0) AS repeat_rate
  , path_journeys
  , path_cvr
  , behavior_sessions
  , behavior_cvr
  , base_aov
  , base_loyal_rate
  , base_repeat_rate
  , base_path_cvr
  , base_behavior_cvr
  , path_cvr_lift
  , behavior_cvr_lift
  , cvr_lift
  , loyalty_lift
  , repeat_lift
  , value_index
  , c_cvr
  , c_loyalty
  , c_repeat
  , c_value
  , c_support
  , 50.0e0 + 50.0e0 * (
      ${golden_path.w_cvr} * c_cvr
      + ${golden_path.w_loyalty} * c_loyalty
      + ${golden_path.w_repeat} * c_repeat
      + ${golden_path.w_value} * c_value
      + ${golden_path.w_support} * c_support
    ) / (${golden_path.w_cvr} + ${golden_path.w_loyalty} + ${golden_path.w_repeat} + ${golden_path.w_value} + ${golden_path.w_support}) AS score
  , CASE WHEN conversions >= ${golden_path.min_support} THEN 1 ELSE 0 END AS meets_support
FROM comps
WHERE pattern_type IS NOT NULL
  AND conversions >= 3
