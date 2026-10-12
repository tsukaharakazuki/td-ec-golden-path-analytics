-- gp_touch_dim: タッチの組み合わせ（source / medium / campaign / content）ごとにチャネルと touch_key を決める
WITH d AS (
  SELECT DISTINCT
    t_source
    , t_medium
    , t_campaign
    , t_content
  FROM gp_hits
  WHERE touch_type IS NOT NULL
)
, matched AS (
  SELECT
    d.t_source
    , d.t_medium
    , d.t_campaign
    , d.t_content
    , r.channel
    , ROW_NUMBER() OVER (
        PARTITION BY d.t_source, d.t_medium, d.t_campaign, d.t_content
        ORDER BY r.priority
      ) AS rn
  FROM d
  CROSS JOIN gp_channel_rules r
  WHERE regexp_like(COALESCE(d.t_source, ''), r.source_regex)
    AND regexp_like(COALESCE(d.t_medium, ''), r.medium_regex)
    AND regexp_like(COALESCE(d.t_campaign, ''), r.campaign_regex)
)
SELECT
  t_source
  , t_medium
  , t_campaign
  , t_content
  , channel
  , CASE '${attribution.grain}'
      WHEN 'channel' THEN channel
      WHEN 'source_medium' THEN t_source || ' / ' || t_medium
      WHEN 'source_medium_campaign' THEN t_source || ' / ' || t_medium || ' / ' || t_campaign
      ELSE t_source || ' / ' || t_medium || ' / ' || t_campaign || ' / ' || t_content
    END AS touch_key
FROM matched
WHERE rn = 1
