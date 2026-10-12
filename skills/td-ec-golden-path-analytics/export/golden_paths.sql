-- ダッシュボード: 採用されたゴールデンパス（種別ごとの上位）
SELECT * FROM {{database}}.gp_golden_paths ORDER BY pattern_type, golden_rank
