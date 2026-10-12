-- gp_rfm_customer: 会員ごとの RFM（POS ベース・各5段階）
--   R: 最終購入からの日数（短いほど高スコア）… 分位（20%刻み）
--   F: 購入回数（注文数）… 既定は閾値 rfm.f_thresholds（同値が多いため）。quantile も選べる
--   M: 購入金額の合計 … 分位（20%刻み）
--   同値は同じスコアになるよう、NTILE ではなく分位点の境界値で判定する
WITH base AS (
  SELECT
    member_id
    , MIN(order_time) AS first_order_time
    , MAX(order_time) AS last_order_time
    , COUNT(DISTINCT order_id) AS frequency
    , SUM(amount) AS monetary
    , SUM(CASE WHEN channel = 'ec' THEN amount ELSE 0 END) AS ec_monetary
    , COUNT(DISTINCT CASE WHEN channel = 'ec' THEN order_id END) AS ec_orders
    , COUNT(DISTINCT CASE WHEN channel <> 'ec' THEN order_id END) AS store_orders
  FROM gp_orders
  WHERE member_id IS NOT NULL
    AND amount > 0
    AND ('${rfm.scope}' = 'all' OR channel = 'ec')
  GROUP BY member_id
)
, b2 AS (
  SELECT
    b.*
    , (TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') - b.last_order_time) / 86400.0e0 AS recency_days
  FROM base b
)
, q AS (
  SELECT
    approx_percentile(recency_days, ARRAY[0.2e0, 0.4e0, 0.6e0, 0.8e0]) AS rq
    , approx_percentile(CAST(frequency AS DOUBLE), ARRAY[0.2e0, 0.4e0, 0.6e0, 0.8e0]) AS fq
    , approx_percentile(monetary, ARRAY[0.2e0, 0.4e0, 0.6e0, 0.8e0]) AS mq
  FROM b2
)
, scored AS (
  SELECT
    b2.*
    , CASE
        WHEN b2.recency_days <= q.rq[1] THEN 5
        WHEN b2.recency_days <= q.rq[2] THEN 4
        WHEN b2.recency_days <= q.rq[3] THEN 3
        WHEN b2.recency_days <= q.rq[4] THEN 2
        ELSE 1
      END AS r_score
    , CASE
        WHEN '${rfm.f_method}' = 'quantile' THEN
          CASE
            WHEN b2.frequency > q.fq[4] THEN 5
            WHEN b2.frequency > q.fq[3] THEN 4
            WHEN b2.frequency > q.fq[2] THEN 3
            WHEN b2.frequency > q.fq[1] THEN 2
            ELSE 1
          END
        ELSE
          CASE
            WHEN b2.frequency >= ${rfm.f_thresholds[3]} THEN 5
            WHEN b2.frequency >= ${rfm.f_thresholds[2]} THEN 4
            WHEN b2.frequency >= ${rfm.f_thresholds[1]} THEN 3
            WHEN b2.frequency >= ${rfm.f_thresholds[0]} THEN 2
            ELSE 1
          END
      END AS f_score
    , CASE
        WHEN b2.monetary > q.mq[4] THEN 5
        WHEN b2.monetary > q.mq[3] THEN 4
        WHEN b2.monetary > q.mq[2] THEN 3
        WHEN b2.monetary > q.mq[1] THEN 2
        ELSE 1
      END AS m_score
  FROM b2
  CROSS JOIN q
)
SELECT
  s.member_id
  , s.first_order_time
  , s.last_order_time
  , s.recency_days
  , s.frequency
  , s.monetary
  , s.ec_monetary
  , s.ec_orders
  , s.store_orders
  , CASE
      WHEN s.ec_orders > 0 AND s.store_orders > 0 THEN 'omni'
      WHEN s.ec_orders > 0 THEN 'ec_only'
      ELSE 'store_only'
    END AS channel_mix
  , s.r_score
  , s.f_score
  , s.m_score
  , 'R' || CAST(s.r_score AS VARCHAR) || 'F' || CAST(s.f_score AS VARCHAR) || 'M' || CAST(s.m_score AS VARCHAR) AS rfm_cell
  , CASE
      WHEN s.r_score >= 4 AND s.f_score >= 4 THEN 'チャンピオン'
      WHEN s.r_score = 3 AND s.f_score >= 4 THEN 'ロイヤル'
      WHEN s.r_score >= 4 AND s.f_score BETWEEN 2 AND 3 THEN '育成候補'
      WHEN s.r_score >= 4 AND s.f_score = 1 THEN '新規'
      WHEN s.r_score = 3 THEN '要注意'
      WHEN s.r_score <= 2 AND s.f_score >= 3 THEN '離反リスク'
      ELSE '休眠'
    END AS segment
  , CASE WHEN ${rfm.loyal_condition} THEN 1 ELSE 0 END AS is_loyal
FROM scored s
