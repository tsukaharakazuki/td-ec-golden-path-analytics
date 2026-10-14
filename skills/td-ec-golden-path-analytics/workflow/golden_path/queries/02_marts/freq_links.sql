-- gp_freq_links: サンキー図の帯（step の値 → 次の列の値）
--   kind = flow  … F<step> → F<step+1>
--          exit  … F<step> で購入が止まった人（to_node = '(離脱)'）。対象を「全員」にしたときだけ表示
--          final … F<max_steps> → 最終列（累計購買金額ランクなど）
--   reached = 1 … F<max_steps> まで購入した人の帯（「到達者のみ」の表示はこれだけを使う）
--   weight は人数（split では金額比率で按分した「人相当」。前後の注文の比率の積）、customers は帯を通る実人数
WITH f AS (
  SELECT * FROM gp_freq_orders
)
, flow AS (
  SELECT
    a.dimension, a.mode, a.step, 'flow' AS kind, a.reached
    , a.node AS from_node, a.node_order AS from_order
    , b.node AS to_node, b.node_order AS to_order
    , a.weight * b.weight AS weight
    , a.member_id
  FROM f a
  JOIN f b
    ON b.member_id = a.member_id AND b.dimension = a.dimension AND b.mode = a.mode AND b.step = a.step + 1
)
, ex AS (
  SELECT
    dimension, mode, step, 'exit' AS kind, reached
    , node AS from_node, node_order AS from_order
    , '(離脱)' AS to_node, 999 AS to_order
    , weight
    , member_id
  FROM f
  WHERE step = last_step
    AND reached = 0
)
, fin AS (
  SELECT
    f.dimension, f.mode, f.step, 'final' AS kind, f.reached
    , f.node AS from_node, f.node_order AS from_order
    , z.final_node AS to_node, z.final_order AS to_order
    , f.weight
    , f.member_id
  FROM f
  JOIN gp_freq_final z ON z.member_id = f.member_id
  WHERE f.step = ${frequency_sankey.max_steps}
)
, u AS (
  SELECT * FROM flow
  UNION ALL
  SELECT * FROM ex
  UNION ALL
  SELECT * FROM fin
)
SELECT
  dimension
  , mode
  , step
  , kind
  , reached
  , from_node
  , MIN(from_order) AS from_order
  , to_node
  , MIN(to_order) AS to_order
  , SUM(weight) AS weight
  , COUNT(DISTINCT member_id) AS customers
FROM u
GROUP BY dimension, mode, step, kind, reached, from_node, to_node
