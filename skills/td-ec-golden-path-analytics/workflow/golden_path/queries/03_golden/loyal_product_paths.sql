-- gp_loyal_product_paths (Q1): ロイヤル顧客は、買っている商品グループごとに、どんな流入経路・サイト内行動をしているか
--   dimension:
--     path          … 流入経路パターン（path_pattern）
--     behavior      … 購入セッションのサイト内行動パターン（behavior_signature）
--     first_channel … 経路の最初のチャネル
--     landing       … 購入セッションの着地ページ種別
--   loyal_share / other_share: その商品グループを買った CV のうち、そのパターンの割合（ロイヤル / それ以外）
--   loyal_index: ロイヤル顧客での出現しやすさ（1 より大きいほどロイヤル顧客に特徴的）
WITH cv AS (
  SELECT cv_id, is_loyal, path_pattern, behavior_signature, first_channel, landing_page_type
  FROM gp_cv_journey
  WHERE is_loyal IS NOT NULL
)
, cvp AS (
  SELECT cv.*, ji.product_group
  FROM cv
  JOIN gp_cv_journey_items ji ON ji.cv_id = cv.cv_id
)
, top_groups AS (
  SELECT product_group
  FROM cvp
  WHERE is_loyal = 1
  GROUP BY product_group
  ORDER BY COUNT(*) DESC
  LIMIT ${golden_path.top_product_groups}
)
, base AS (
  SELECT c.product_group, c.cv_id, c.is_loyal, c.path_pattern, c.behavior_signature, c.first_channel, c.landing_page_type
  FROM cvp c
  JOIN top_groups g ON g.product_group = c.product_group
  UNION ALL
  SELECT '(全商品)' AS product_group, cv_id, is_loyal, path_pattern, behavior_signature, first_channel, landing_page_type
  FROM cv
)
, long AS (
  SELECT product_group, 'path' AS dimension, path_pattern AS pattern, is_loyal FROM base
  UNION ALL
  SELECT product_group, 'behavior' AS dimension, behavior_signature AS pattern, is_loyal FROM base
  UNION ALL
  SELECT product_group, 'first_channel' AS dimension, first_channel AS pattern, is_loyal FROM base
  UNION ALL
  SELECT product_group, 'landing' AS dimension, landing_page_type AS pattern, is_loyal FROM base
)
, agg AS (
  SELECT
    product_group
    , dimension
    , COALESCE(pattern, '(不明)') AS pattern
    , COUNT_IF(is_loyal = 1) AS loyal_cv
    , COUNT_IF(is_loyal = 0) AS other_cv
  FROM long
  GROUP BY 1, 2, 3
)
, tot AS (
  SELECT product_group, dimension, SUM(loyal_cv) AS loyal_total, SUM(other_cv) AS other_total
  FROM agg
  GROUP BY 1, 2
)
, scored AS (
  SELECT
    a.product_group
    , a.dimension
    , a.pattern
    , a.loyal_cv
    , a.other_cv
    , t.loyal_total
    , t.other_total
    , CAST(a.loyal_cv AS DOUBLE) / NULLIF(t.loyal_total, 0) AS loyal_share
    , CAST(a.other_cv AS DOUBLE) / NULLIF(t.other_total, 0) AS other_share
    , ((a.loyal_cv + 0.5e0) / (t.loyal_total + 0.5e0)) / ((a.other_cv + 0.5e0) / (t.other_total + 0.5e0)) AS loyal_index
    , ROW_NUMBER() OVER (PARTITION BY a.product_group, a.dimension ORDER BY a.loyal_cv DESC, a.other_cv DESC) AS rank_in_group
  FROM agg a
  JOIN tot t ON t.product_group = a.product_group AND t.dimension = a.dimension
)
SELECT *
FROM scored
WHERE rank_in_group <= 20
