-- gp_channel_rules: タッチ（source / medium / campaign）→ チャネルの分類ルール
--
-- セットアップ時に、実データの utm 値の棚卸し（references/data-discovery.md の Q4）を見て編集します。
-- priority の小さいルールから順に判定し、最初に一致したチャネルを採用します。
-- 各 *_regex は regexp_like で評価します。'.*' はすべてに一致します。
-- source / medium は小文字化済み。campaign は元の大文字小文字のままなので (?i) を付けます。
-- source は、utm が無いリファラ流入ではリファラのホスト、直接流入では '(direct)' になります。

SELECT
  priority
  , channel
  , source_regex
  , medium_regex
  , campaign_regex
FROM (
  VALUES
    (10,  'Email',          '.*',                                                              '^(e-?mail|mail|newsletter|mailmagazine|mailmag|crm_mail)$', '.*')
  , (20,  'LINE',           '^(line|line_oa|lineoa|line_official)$',                           '.*',                                                       '.*')
  , (30,  'PMax',           '.*',                                                              '.*',                                                       '(?i)(pmax|performance[ _-]?max)')
  , (40,  'Paid Search',    '.*',                                                              '^(cpc|ppc|paidsearch|paid_search|sem|listing)$',           '.*')
  , (50,  'Paid Social',    '.*',                                                              '^(paid_?social|social_?ad|sns_?ad|cpm_social)$',           '.*')
  , (51,  'Paid Social',    '^(facebook|instagram|meta|fb|ig|tiktok|x|twitter|line_ads|pinterest|snapchat)$', '^(cpm|cpc|paid|ad|ads|display)$',        '.*')
  , (60,  'Display',        '.*',                                                              '^(display|banner|cpm|retargeting|rtg|video)$',             '.*')
  , (70,  'Affiliate',      '.*',                                                              '^(affiliate|aff|cpa)$',                                    '.*')
  , (80,  'Organic Social', '(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|line\.me|tiktok\.com|pinterest\.(com|jp)|youtube\.com|threads\.net)$', '^(referral|social)$', '.*')
  , (81,  'Organic Social', '^(facebook|instagram|twitter|x|tiktok|pinterest|youtube|threads)$', '^(social|sns|organic_social|referral)$',                  '.*')
  , (90,  'Organic Search', '.*',                                                              '^organic$',                                                '.*')
  , (100, 'Referral',       '.*',                                                              '^referral$',                                               '.*')
  , (110, 'Direct',         '^\(direct\)$',                                                    '.*',                                                       '.*')
  , (999, 'Other',          '.*',                                                              '.*',                                                       '.*')
) AS t (priority, channel, source_regex, medium_regex, campaign_regex)
