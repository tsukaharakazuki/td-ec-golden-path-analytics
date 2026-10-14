# bundle.json の形式

ダッシュボードが読み込むデータ。`gp-cli.mjs bundle` が、抽出 SQL（`skills/td-ec-golden-path-analytics/export/<key>.sql`）の結果 JSON をまとめて作る。

```jsonc
{
  "format": "td-ec-golden-path-analytics/bundle",
  "version": 1,
  "meta": {
    "client": "顧客名",
    "generated_at": "2026-10-12T04:30:00.000Z",
    "workflow": { "project": "golden_path", "attempt_id": "123456" },
    "config": { /* params.yml の要約（データソース、アトリビューション、RFM、スコアの重みなど） */ }
  },
  "kpi": { /* gp_dash_kpi の 1 行 */ },
  "funnel": [], "attribution_channel": [], "attribution_touch": [], "path_length": [], "top_paths": [],
  "rfm_matrix": [], "rfm_segments": [], "golden_paths": [], "golden_candidates": [],
  "loyal_product_paths": [], "loyal_behavior_stats": [], "ad_contribution": [], "ad_product": [],
  "email_influence": [], "email_product": [],
  "freq_links": [], "freq_nodes": [], "freq_outcome": [], "freq_combos": []
}
```

| キー | 元のテーブル | 行数の目安 |
|---|---|---|
| kpi | gp_dash_kpi | 1（オブジェクト） |
| funnel | gp_funnel_summary | チャネル数 + 1 |
| attribution_channel | gp_attribution_channel | チャネル数 |
| attribution_touch | gp_attribution_summary | 最大 300 |
| path_length | gp_path_length | 〜20 |
| top_paths | gp_top_paths | 最大 50 |
| rfm_matrix | gp_rfm_matrix | 125 |
| rfm_segments | gp_rfm_segments | 最大 2,000 |
| golden_paths | gp_golden_paths | 種別 × top_n |
| golden_candidates | gp_golden_path_candidates | 種別 × 最大 100 |
| loyal_product_paths | gp_loyal_product_paths | 商品グループ × 観点 × 20 |
| loyal_behavior_stats | gp_loyal_behavior_stats | 商品グループ × 2 |
| ad_contribution | gp_ad_contribution | 最大 300 |
| ad_product | gp_ad_product | 広告 × 30 |
| email_influence | gp_email_influence | 最大 300 |
| email_product | gp_email_product | メール × 50 |
| freq_links | gp_freq_links | 軸 × 見せ方 × 回数 × 値² × 2（数百〜数千） |
| freq_nodes | gp_freq_nodes | 軸 × 見せ方 × 回数 × 値 × 2 |
| freq_outcome | gp_freq_outcome | 軸 × 見せ方 × 回数 × 値 × ランク |
| freq_combos | gp_freq_combos | 軸 × 回数 × 20 |

`freq_*` は後から追加したキー。古い bundle.json に無い場合、ダッシュボードは「購入回数の推移」を空として表示する。
各行の `mode` は `primary` / `mixed` / `split`（1注文に複数の値があるときの見せ方）または `single`（金額帯・チャネルのように値が1つの軸）。

各行のカラムはテーブルと同じ。数値は数値で持つ（`tdx query --json` が文字列で返した数値は、ID・名前系のカラムを除いて数値に変換する）。

- 必須: `kpi`, `attribution_channel`, `rfm_matrix`, `golden_paths`（空でもよいが、空なら警告）
- 個人を特定する値（会員ID・cookie・メールアドレス）は含めない。抽出 SQL はすべて集計済みのテーブルを読む
- ダッシュボード HTML は、テンプレートの `<script id="gp-data" type="application/json">null</script>` をこの JSON で置き換えたもの
