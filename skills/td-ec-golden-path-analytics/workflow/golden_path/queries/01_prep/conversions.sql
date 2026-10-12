-- gp_conversions: Webログの購入完了（EC コンバージョン）
--   - 注文IDがあれば注文ID単位で重複排除（購入完了ページの再読み込み対策）
--   - 注文IDが無ければ、同一人物で ${cv.dedupe_minutes} 分以内の購入完了ヒットを1件にまとめる
--   - 売上: ecommerce.value → POS の注文金額（注文IDが一致する場合）の順
--   - 新規購入: POS に、この注文より前の購入が無い（会員のみ判定可能。非会員は期間内の初回CV）
WITH cv_hits AS (
  SELECT
    person_key
    , member_id
    , cookie
    , session_id
    , time AS cv_time
    , hit_seq
    , COALESCE(
        cv_order_id_raw,
        NULLIF(json_extract_scalar(ecommerce_json, '${ecommerce.transaction_id_path}'), '')
      ) AS order_id
    , TRY_CAST(json_extract_scalar(ecommerce_json, '${ecommerce.value_path}') AS DOUBLE) AS ec_value
    , ecommerce_json
  FROM gp_hits
  WHERE is_cv_hit = 1
)
, with_prev AS (
  SELECT
    c.*
    , LAG(c.cv_time) OVER (PARTITION BY c.person_key ORDER BY c.hit_seq) AS prev_hit_time
  FROM cv_hits c
)
, dedup AS (
  SELECT *
  FROM (
    SELECT
      w.*
      , ROW_NUMBER() OVER (PARTITION BY w.order_id ORDER BY w.hit_seq) AS rn
    FROM with_prev w
    WHERE w.order_id IS NOT NULL
  ) x
  WHERE rn = 1
  UNION ALL
  SELECT w.*, 1 AS rn
  FROM with_prev w
  WHERE w.order_id IS NULL
    AND (w.prev_hit_time IS NULL OR w.cv_time - w.prev_hit_time > ${cv.dedupe_minutes} * 60)
)
, pos_first AS (
  SELECT member_id, MIN(order_time) AS first_order_time
  FROM gp_orders
  WHERE member_id IS NOT NULL
  GROUP BY member_id
)
, ordered AS (
  SELECT
    d.*
    , ROW_NUMBER() OVER (PARTITION BY d.person_key ORDER BY d.hit_seq) AS cv_seq
    , LAG(d.cv_time) OVER (PARTITION BY d.person_key ORDER BY d.hit_seq) AS prev_cv_time
  FROM dedup d
)
SELECT
  COALESCE(o.order_id, o.person_key || '@' || CAST(o.cv_time AS VARCHAR)) AS cv_id
  , o.order_id
  , o.person_key
  , o.member_id
  , o.cookie
  , o.session_id
  , o.cv_time
  , o.hit_seq
  , o.cv_seq
  , o.prev_cv_time
  , COALESCE(
      o.ec_value,
      CASE WHEN ${source.pos.order_id_matches_web} THEN po.amount END
    ) AS revenue
  , CASE
      WHEN o.member_id IS NOT NULL AND pf.first_order_time IS NOT NULL
        THEN CASE WHEN pf.first_order_time >= o.cv_time - 86400 THEN 1 ELSE 0 END
      WHEN o.cv_seq = 1 THEN 1
      ELSE 0
    END AS is_new_customer
  , o.ecommerce_json
FROM ordered o
LEFT JOIN gp_orders po
  ON ${source.pos.order_id_matches_web}
 AND po.order_id = o.order_id
LEFT JOIN pos_first pf
  ON pf.member_id = o.member_id
