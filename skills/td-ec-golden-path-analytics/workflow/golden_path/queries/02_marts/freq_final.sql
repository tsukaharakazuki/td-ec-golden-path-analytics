-- gp_freq_final: F<max_steps> まで購入した会員の最終列
--   amount_rank … F<max_steps> 時点の累計購買金額を rank_thresholds で区切ったランク
--   rfm_segment … 現在の RFM セグメント（gp_rfm_customer）
--   final_order は大きいほど上位
WITH cfg AS (
  SELECT
    transform(split('${frequency_sankey.rank_thresholds}', ','), x -> CAST(TRIM(x) AS DOUBLE)) AS th
    , transform(split('${frequency_sankey.rank_labels}', ','), x -> TRIM(x)) AS labels
)
, last AS (
  SELECT member_id, MAX(cum_amount) AS cum_amount
  FROM gp_freq_orders
  WHERE reached = 1
    AND step = ${frequency_sankey.max_steps}
  GROUP BY 1
)
, ranked AS (
  SELECT
    last.member_id
    , last.cum_amount
    , cardinality(filter(cfg.th, x -> x <= last.cum_amount)) AS k
    , cfg.labels
  FROM last
  CROSS JOIN cfg
)
SELECT
  r.member_id
  , r.cum_amount
  , CASE
      WHEN '${frequency_sankey.final_column}' = 'rfm_segment' THEN COALESCE(c.segment, '(RFM なし)')
      ELSE COALESCE(element_at(r.labels, r.k + 1), 'ランク' || CAST(r.k + 1 AS VARCHAR))
    END AS final_node
  , CASE
      WHEN '${frequency_sankey.final_column}' = 'rfm_segment' THEN
        CASE c.segment
          WHEN 'チャンピオン' THEN 7 WHEN 'ロイヤル' THEN 6 WHEN '育成候補' THEN 5 WHEN '新規' THEN 4
          WHEN '要注意' THEN 3 WHEN '離反リスク' THEN 2 WHEN '休眠' THEN 1 ELSE 0
        END
      ELSE r.k + 1
    END AS final_order
FROM ranked r
LEFT JOIN gp_rfm_customer c ON c.member_id = r.member_id
WHERE '${frequency_sankey.final_column}' <> 'none'
