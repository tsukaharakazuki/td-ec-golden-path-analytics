-- gp_golden_paths: ゴールデンパスの採用パターン
--   最小 CV 数（${golden_path.min_support}）を満たす候補から、種別ごとにスコア上位 ${golden_path.top_n} 件を採用。
--   同じ入口（最初のチャネル／最初のページ種別）からは最大 ${golden_path.max_per_entry} 件までにして、似たパターンの重複を避ける。
--   strengths: スコアへの寄与が大きい要素（上位2つ）
WITH eligible AS (
  SELECT
    c.*
    , ROW_NUMBER() OVER (PARTITION BY c.pattern_type, c.entry_key ORDER BY c.score DESC, c.conversions DESC) AS rank_in_entry
  FROM gp_golden_path_candidates c
  WHERE c.meets_support = 1
)
, diverse AS (
  SELECT
    e.*
    , ROW_NUMBER() OVER (PARTITION BY e.pattern_type ORDER BY e.score DESC, e.conversions DESC) AS rank_in_type
  FROM eligible e
  WHERE e.rank_in_entry <= ${golden_path.max_per_entry}
)
, picked AS (
  SELECT *
  FROM diverse
  WHERE rank_in_type <= ${golden_path.top_n}
)
, strengths AS (
  SELECT
    p.pattern_type
    , p.rank_in_type
    , array_join(
        transform(
          slice(
            reverse(array_sort(ARRAY[
              format('%.6f|cvr', 2 + p.c_cvr * ${golden_path.w_cvr})
              , format('%.6f|loyalty', 2 + p.c_loyalty * ${golden_path.w_loyalty})
              , format('%.6f|repeat', 2 + p.c_repeat * ${golden_path.w_repeat})
              , format('%.6f|value', 2 + p.c_value * ${golden_path.w_value})
              , format('%.6f|support', 2 + p.c_support * ${golden_path.w_support})
            ])),
            1, 2
          ),
          x -> split_part(x, '|', 2)
        ),
        ','
      ) AS strengths
  FROM picked p
)
SELECT
  p.pattern_type
  , p.rank_in_type AS golden_rank
  , p.path_pattern
  , p.behavior_signature
  , p.product_group
  , p.entry_key
  , p.score
  , s.strengths
  , p.conversions
  , p.customers
  , p.revenue
  , p.revenue_per_cv
  , p.loyal_rate
  , p.repeat_rate
  , p.path_cvr
  , p.behavior_cvr
  , p.cvr_lift
  , p.loyalty_lift
  , p.repeat_lift
  , p.value_index
  , p.c_cvr
  , p.c_loyalty
  , p.c_repeat
  , p.c_value
  , p.c_support
  , p.base_aov
  , p.base_loyal_rate
  , p.base_repeat_rate
  , p.base_path_cvr
  , p.base_behavior_cvr
FROM picked p
JOIN strengths s
  ON s.pattern_type = p.pattern_type
 AND s.rank_in_type = p.rank_in_type
