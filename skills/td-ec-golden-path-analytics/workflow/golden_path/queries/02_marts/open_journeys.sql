-- gp_open_journeys: まだコンバージョンしていない経路（ゴールデンパスの CVR 計算の分母に使う）
--   集計期間の最後の ${attribution.lookback_days} 日に、最後の CV より後のタッチがある人物の
--   直近 ${attribution.max_generations} 世代を、gp_cv_journey と同じ方法でパターン化する
WITH period_end AS (
  SELECT TD_DATE_TRUNC('day', TD_SCHEDULED_TIME(), '${common.td_tz}') AS end_time
)
, last_cv AS (
  SELECT person_key, MAX(cv_time) AS last_cv_time
  FROM gp_conversions
  GROUP BY person_key
)
, t AS (
  SELECT
    tp.person_key
    , tp.hit_seq
    , tp.channel
    , ROW_NUMBER() OVER (PARTITION BY tp.person_key ORDER BY tp.hit_seq DESC) AS rev_pos
  FROM gp_touchpoints tp
  CROSS JOIN period_end pe
  LEFT JOIN last_cv l ON l.person_key = tp.person_key
  WHERE tp.touch_time > pe.end_time - ${attribution.lookback_days} * 86400
    AND tp.touch_time > COALESCE(l.last_cv_time, 0)
)
, kept AS (
  SELECT
    person_key
    , hit_seq
    , channel
    , LAG(channel) OVER (PARTITION BY person_key ORDER BY hit_seq) AS prev_channel
  FROM t
  WHERE rev_pos <= ${attribution.max_generations}
)
, dedup AS (
  SELECT
    person_key
    , hit_seq
    , channel
    , ROW_NUMBER() OVER (PARTITION BY person_key ORDER BY hit_seq DESC) AS rev_step
    , COUNT(*) OVER (PARTITION BY person_key) AS n_steps
  FROM kept
  WHERE prev_channel IS NULL OR prev_channel <> channel
)
SELECT
  person_key
  , CASE WHEN MAX(n_steps) > ${golden_path.path_steps} THEN '… > ' ELSE '' END
    || array_join(
         array_agg(CASE WHEN rev_step <= ${golden_path.path_steps} THEN channel END ORDER BY hit_seq),
         ' > '
       ) AS path_pattern
  , min_by(channel, hit_seq) AS first_channel
  , MAX(n_steps) AS channel_steps
FROM dedup
GROUP BY person_key
