-- ダッシュボード: ゴールデンパス候補（最小 CV 数を満たすもの、種別ごとにスコア上位 100）
SELECT *
FROM (
  SELECT
    c.*
    , ROW_NUMBER() OVER (PARTITION BY pattern_type ORDER BY score DESC) AS score_rank
  FROM {{database}}.gp_golden_path_candidates c
  WHERE meets_support = 1
) x
WHERE score_rank <= 100
ORDER BY pattern_type, score_rank
