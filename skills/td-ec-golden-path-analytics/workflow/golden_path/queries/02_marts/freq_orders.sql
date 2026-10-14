-- gp_freq_orders: 新規顧客の F1〜F<max_steps> の注文を、軸（dimension）ごとの値（node）に変換
--   1行 = 会員 × 何回目の購入（step）× 軸 × 見せ方（mode）× 値
--   1注文に複数の値があるとき（例: 2カテゴリを同時購入）の見せ方を3通り持つ:
--     primary … 金額が最大の値を1つ選ぶ（weight = 1）
--     mixed   … 2つ以上なら「複数カテゴリ」などにまとめる（weight = 1）
--     split   … 値ごとの金額比率で按分（weight の合計 = 1）
--   金額帯・チャネルは注文に1つしか値が無いので mode = single
WITH bounds AS (
  SELECT TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') - ${common.pos_lookback_days} * 86400 AS pos_from
)
, o AS (
  SELECT order_id, member_id, order_time, channel, amount
  FROM gp_orders
  WHERE member_id IS NOT NULL
    AND amount > 0
    AND ('${frequency_sankey.scope}' = 'all' OR channel = 'ec')
    AND ${frequency_sankey.enabled}
)
, seq AS (
  SELECT
    o.*
    , ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY order_time, order_id) AS step
    , COUNT(*) OVER (PARTITION BY member_id) AS orders_total
    , MIN(order_time) OVER (PARTITION BY member_id) AS first_time
    , SUM(amount) OVER (PARTITION BY member_id ORDER BY order_time, order_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_amount
  FROM o
)
, cohort AS (
  SELECT s.*
  FROM seq s
  CROSS JOIN bounds b
  WHERE s.first_time >= b.pos_from + ${frequency_sankey.new_customer_gap_days} * 86400
    AND s.step <= ${frequency_sankey.max_steps}
)
-- 明細の軸の値（商品マスタ → POS 明細の順）
, li AS (
  SELECT
    c.member_id
    , c.step
    , l.product_id
    , COALESCE(d.product_name, l.product_name) AS product_name
    , COALESCE(NULLIF(d.category, '(不明)'), l.category) AS category
    , COALESCE(NULLIF(d.brand, '(不明)'), l.brand) AS brand
    , GREATEST(COALESCE(l.amount, 0e0), 0e0) AS amount
  FROM cohort c
  JOIN gp_order_lines l ON l.order_id = c.order_id
  LEFT JOIN gp_product_dim d ON d.product_id = l.product_id
)
, li_dim AS (
  SELECT member_id, step, amount, 'category' AS dimension, CAST(category AS VARCHAR) AS raw_value FROM li
  UNION ALL
  SELECT member_id, step, amount, 'brand' AS dimension, CAST(brand AS VARCHAR) AS raw_value FROM li
  UNION ALL
  SELECT member_id, step, amount, 'custom' AS dimension, CAST(${frequency_sankey.custom_expr} AS VARCHAR) AS raw_value FROM li
)
, v AS (
  SELECT
    member_id
    , step
    , dimension
    , COALESCE(NULLIF(TRIM(raw_value), ''), '(不明)') AS raw_value
    , SUM(amount) AS amount
  FROM li_dim
  WHERE strpos(',' || replace('${frequency_sankey.dimensions}', ' ', '') || ',', ',' || dimension || ',') > 0
  GROUP BY 1, 2, 3, 4
)
-- 表示する値: 購入者数の多い上位 top_nodes 件。残りと不明は「その他」
, top AS (
  SELECT
    dimension
    , raw_value
    , ROW_NUMBER() OVER (PARTITION BY dimension ORDER BY COUNT(DISTINCT member_id) DESC, SUM(amount) DESC, raw_value) AS rnk
  FROM v
  WHERE raw_value <> '(不明)'
  GROUP BY 1, 2
)
, vm AS (
  SELECT
    v.member_id
    , v.step
    , v.dimension
    , v.raw_value
    , v.amount
    , CASE WHEN t.rnk <= ${frequency_sankey.top_nodes} THEN v.raw_value ELSE 'その他' END AS node
    , CASE WHEN t.rnk <= ${frequency_sankey.top_nodes} THEN t.rnk ELSE 99 END AS node_order
  FROM v
  LEFT JOIN top t ON t.dimension = v.dimension AND t.raw_value = v.raw_value
)
-- 注文 × 軸の要約: 値の数（不明を除く）・金額・組み合わせ・金額最大の値
, per_order AS (
  SELECT
    member_id
    , step
    , dimension
    , COUNT(DISTINCT CASE WHEN raw_value <> '(不明)' THEN raw_value END) AS n_values
    , SUM(amount) AS amount_total
    , array_join(array_sort(array_agg(DISTINCT node)), ' + ') AS combo
    , max_by(node, amount * 10 + CASE WHEN raw_value = '(不明)' THEN 0 ELSE 1 END) AS primary_node
    , max_by(node_order, amount * 10 + CASE WHEN raw_value = '(不明)' THEN 0 ELSE 1 END) AS primary_order
  FROM vm
  GROUP BY 1, 2, 3
)
, per_node AS (
  SELECT member_id, step, dimension, node, MIN(node_order) AS node_order, SUM(amount) AS amount, COUNT(*) AS n_raw
  FROM vm
  GROUP BY 1, 2, 3, 4
)
, multi_rows AS (
  -- primary
  SELECT p.member_id, p.step, p.dimension, 'primary' AS mode, p.primary_node AS node, p.primary_order AS node_order, 1e0 AS weight
    , p.n_values, p.combo
  FROM per_order p
  UNION ALL
  -- mixed
  SELECT
    p.member_id, p.step, p.dimension, 'mixed' AS mode
    , CASE
        WHEN p.n_values < 2 THEN p.primary_node
        WHEN p.dimension = 'category' THEN '複数カテゴリ'
        WHEN p.dimension = 'brand' THEN '複数ブランド'
        ELSE '複数（${frequency_sankey.custom_label}）'
      END AS node
    , CASE WHEN p.n_values < 2 THEN p.primary_order ELSE 90 END AS node_order
    , 1e0 AS weight
    , p.n_values, p.combo
  FROM per_order p
  UNION ALL
  -- split
  SELECT
    n.member_id, n.step, n.dimension, 'split' AS mode, n.node, n.node_order
    , CASE
        WHEN p.amount_total > 0 THEN n.amount / p.amount_total
        ELSE 1e0 / COUNT(*) OVER (PARTITION BY n.member_id, n.step, n.dimension)
      END AS weight
    , p.n_values, p.combo
  FROM per_node n
  JOIN per_order p ON p.member_id = n.member_id AND p.step = n.step AND p.dimension = n.dimension
)
-- 金額帯
, bands AS (
  SELECT transform(split('${frequency_sankey.amount_bands}', ','), x -> CAST(TRIM(x) AS BIGINT)) AS b
)
, banded AS (
  SELECT
    c.member_id
    , c.step
    , cardinality(filter(bands.b, x -> x <= c.amount)) AS k
    , cardinality(bands.b) AS n
    , bands.b
  FROM cohort c
  CROSS JOIN bands
)
, single_rows AS (
  SELECT
    member_id, step, 'amount_band' AS dimension, 'single' AS mode
    , CASE
        WHEN k = 0 THEN yen_lo || '円未満'
        WHEN k = n THEN yen_hi || '円以上'
        ELSE yen_lo || '〜' || yen_hi || '円'
      END AS node
    , k AS node_order, 1e0 AS weight, 1 AS n_values, CAST(NULL AS VARCHAR) AS combo
  FROM (
    SELECT
      member_id, step, k, n
      -- 下限（k=0 のときは最初の区切り）と上限（k=n のときは最後の区切り）を「3千」「1万」の形で
      , CASE
          WHEN lo >= 10000 AND lo % 10000 = 0 THEN CAST(CAST(lo / 10000 AS BIGINT) AS VARCHAR) || '万'
          WHEN lo >= 1000 AND lo % 1000 = 0 THEN CAST(CAST(lo / 1000 AS BIGINT) AS VARCHAR) || '千'
          ELSE CAST(lo AS VARCHAR)
        END AS yen_lo
      , CASE
          WHEN hi >= 10000 AND hi % 10000 = 0 THEN CAST(CAST(hi / 10000 AS BIGINT) AS VARCHAR) || '万'
          WHEN hi >= 1000 AND hi % 1000 = 0 THEN CAST(CAST(hi / 1000 AS BIGINT) AS VARCHAR) || '千'
          ELSE CAST(hi AS VARCHAR)
        END AS yen_hi
    FROM (
      SELECT
        member_id, step, k, n
        , CASE WHEN k = 0 THEN b[1] ELSE b[k] END AS lo
        , CASE WHEN k = n THEN b[n] ELSE b[k + 1] END AS hi
      FROM banded
    ) x
  ) y
  WHERE strpos(',' || replace('${frequency_sankey.dimensions}', ' ', '') || ',', ',amount_band,') > 0
  UNION ALL
  SELECT
    member_id, step, 'channel' AS dimension, 'single' AS mode
    , CASE channel WHEN 'ec' THEN 'EC' WHEN 'store' THEN '店舗' ELSE COALESCE(channel, '(不明)') END AS node
    , CASE channel WHEN 'ec' THEN 1 WHEN 'store' THEN 2 ELSE 9 END AS node_order
    , 1e0 AS weight, 1 AS n_values, CAST(NULL AS VARCHAR) AS combo
  FROM cohort
  WHERE strpos(',' || replace('${frequency_sankey.dimensions}', ' ', '') || ',', ',channel,') > 0
)
, all_rows AS (
  SELECT * FROM multi_rows
  UNION ALL
  SELECT * FROM single_rows
)
SELECT
  r.member_id
  , r.step
  , c.order_id
  , c.order_time
  , c.amount AS order_amount
  , c.cum_amount
  , c.orders_total
  , CASE WHEN c.orders_total >= ${frequency_sankey.max_steps} THEN 1 ELSE 0 END AS reached
  , LEAST(c.orders_total, ${frequency_sankey.max_steps}) AS last_step
  , r.dimension
  , r.mode
  , r.node
  , r.node_order
  , r.weight
  , CASE WHEN r.n_values >= 2 THEN 1 ELSE 0 END AS is_multi
  , r.n_values
  , CASE WHEN r.n_values >= 2 THEN r.combo END AS combo
FROM all_rows r
JOIN cohort c ON c.member_id = r.member_id AND c.step = r.step
