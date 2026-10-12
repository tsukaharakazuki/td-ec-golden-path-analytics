-- ダッシュボード: 購買サイクルのファネル（最初の流入チャネル別 ＋ 全体）
SELECT * FROM {{database}}.gp_funnel_summary ORDER BY persons DESC
