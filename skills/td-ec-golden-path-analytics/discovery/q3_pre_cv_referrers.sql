-- Q3 購入直前に現れる外部リファラ（直近30日）
-- 購入完了ヒットと、その直前 3 ヒット（同じ cookie・30 分以内）の外部リファラのホストを数え、
-- サイト全体の外部リファラに占める割合（all_share）と比べる。pre_cv_share が all_share より大きく、
-- pre_cv_hits / all_ext_hits が 1 に近いホストは、
-- 決済サービス・3D セキュア・会員アプリなど「流入ではない」リファラの可能性が高い。
WITH h AS (
  SELECT
    CAST(${source.weblog.cookie_col} AS VARCHAR) AS cookie
    , time
    , LOWER(url_extract_host(${source.weblog.referrer_col})) AS ref_host
    , CASE WHEN ${cv.condition} THEN 1 ELSE 0 END AS is_cv
  FROM ${source.weblog.db}.${source.weblog.table}
  WHERE TD_INTERVAL(time, '-30d', '${common.td_tz}')
    AND ${source.weblog.filter_condition}
)
, seq AS (
  SELECT
    h.*
    , LEAD(is_cv, 1) OVER (PARTITION BY cookie ORDER BY time) AS cv1
    , LEAD(is_cv, 2) OVER (PARTITION BY cookie ORDER BY time) AS cv2
    , LEAD(is_cv, 3) OVER (PARTITION BY cookie ORDER BY time) AS cv3
    , LEAD(time, 3) OVER (PARTITION BY cookie ORDER BY time) AS t3
  FROM h
)
, ext AS (
  SELECT
    ref_host
    , CASE WHEN is_cv = 1 OR ((cv1 = 1 OR cv2 = 1 OR cv3 = 1) AND COALESCE(t3, time) - time <= 1800) THEN 1 ELSE 0 END AS near_cv
  FROM seq
  WHERE ref_host IS NOT NULL
    AND ref_host <> ''
    AND NOT regexp_like(ref_host, '${touch.internal_host_regex}')
)
, agg AS (
  SELECT
    ref_host
    , SUM(near_cv) AS pre_cv_hits
    , COUNT(*) AS all_ext_hits
  FROM ext
  GROUP BY ref_host
)
SELECT *
FROM (
  SELECT
    ref_host
    , pre_cv_hits
    , all_ext_hits
    , CAST(pre_cv_hits AS DOUBLE) / NULLIF(SUM(pre_cv_hits) OVER (), 0) AS pre_cv_share
    , CAST(all_ext_hits AS DOUBLE) / NULLIF(SUM(all_ext_hits) OVER (), 0) AS all_share
    , CASE WHEN regexp_like(ref_host, '${touch.exclude_referrer_regex}') THEN 1 ELSE 0 END AS already_excluded
  FROM agg
) x
WHERE pre_cv_hits > 0
ORDER BY pre_cv_hits DESC
LIMIT 50
