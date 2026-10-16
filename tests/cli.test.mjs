// node --test tests/cli.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  DATASETS, appendMemory, assertSharedPath, buildBundle, check, checkFrequency, discoverySql, exportSql, findWorkDir, lookup, parseYaml,
  privateFolderOf, readRows, renderDashboard, validateBundle,
} from '../skills/td-ec-golden-path-analytics/scripts/gp-cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = path.join(ROOT, 'skills', 'td-ec-golden-path-analytics')
const WF = path.join(SKILL, 'workflow', 'golden_path')
const SAMPLE = path.join(ROOT, 'dashboard', 'public', 'sample-bundle.json')
const CLI = path.join(SKILL, 'scripts', 'gp-cli.mjs')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gp-test-'))

test('params.yml parses, including regex strings and inline lists', () => {
  const p = parseYaml(fs.readFileSync(path.join(WF, 'config', 'params.yml'), 'utf8'))
  assert.equal(p.common.database, 'golden_path_mart')
  assert.deepEqual(p.rfm.f_thresholds, [2, 3, 5, 8])
  assert.equal(p.attribution.reset_after_conversion, true)
  assert.equal(p.pages.top_regex, '^/?(\\?.*)?$')
  assert.equal(lookup(p, 'rfm.f_thresholds[3]'), 8)
  assert.equal(lookup(p, '!source.pos.enabled'), true)
})

test('check: the template only fails on unconfirmed source settings', () => {
  const { errors } = check(WF)
  assert.ok(errors.length > 0)
  for (const e of errors) assert.match(e, /<TO_BE_CONFIRMED>/)
})

test('check: a filled-in copy passes and every ${param} resolves', () => {
  const dir = tmp()
  fs.cpSync(WF, dir, { recursive: true })
  const pp = path.join(dir, 'config', 'params.yml')
  let text = fs.readFileSync(pp, 'utf8')
  text = text.replace('db: <TO_BE_CONFIRMED>\n    table: <TO_BE_CONFIRMED>\n    cookie_col', 'db: web\n    table: pv\n    cookie_col')
  text = text.replace('internal_host_regex: "<TO_BE_CONFIRMED>"', 'internal_host_regex: "(^|\\\\.)example\\\\.com$"')
  fs.writeFileSync(pp, text)
  const { errors } = check(dir)
  assert.deepEqual(errors, [])
})

test('check: an unknown parameter in SQL is reported', () => {
  const dir = tmp()
  fs.cpSync(WF, dir, { recursive: true })
  fs.appendFileSync(path.join(dir, 'queries', '01_prep', 'orders.sql'), '\n-- ${common.not_a_key}\n')
  const { errors } = check(dir)
  assert.ok(errors.some((e) => e.includes('common.not_a_key')))
})

test('every dashboard dataset has an export query, and export-sql fills the database', () => {
  const out = tmp()
  const files = exportSql('my_db', out)
  assert.equal(files.length, DATASETS.length)
  for (const f of files) {
    const sql = fs.readFileSync(f, 'utf8')
    assert.ok(!sql.includes('{{database}}'))
    assert.match(sql, /my_db\.gp_/)
  }
  assert.throws(() => exportSql('bad;name', out))
})

test('discovery-sql skips queries with unconfirmed values', () => {
  const p = parseYaml(fs.readFileSync(path.join(WF, 'config', 'params.yml'), 'utf8'))
  const { written, skipped } = discoverySql(p, tmp())
  assert.equal(written.length, 0)
  assert.ok(skipped.length >= 9)
  p.source.weblog.db = 'web'
  p.source.weblog.table = 'pv'
  const r2 = discoverySql(p, tmp(), ['q1', 'q2', 'q4'])
  assert.equal(r2.written.length, 3)
  for (const f of r2.written) assert.ok(!fs.readFileSync(f, 'utf8').includes('${'))
})

test('readRows accepts arrays, column/row objects and JSON Lines', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([{ x: 1 }]))
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ columns: [{ name: 'x' }], rows: [[2]] }))
  fs.writeFileSync(path.join(dir, 'c.json'), '{"x":3}\n{"x":4}\n')
  assert.deepEqual(readRows(path.join(dir, 'a.json')), [{ x: 1 }])
  assert.deepEqual(readRows(path.join(dir, 'b.json')), [{ x: 2 }])
  assert.deepEqual(readRows(path.join(dir, 'c.json')), [{ x: 3 }, { x: 4 }])
})

test('bundle → validate → dashboard round trip on the sample data', () => {
  const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
  const dir = tmp()
  for (const k of DATASETS) {
    const rows = k === 'kpi' ? [sample.kpi] : sample[k]
    // simulate tdx returning numbers as strings
    const asStrings = rows.map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, typeof v === 'number' ? String(v) : v])))
    fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(asStrings))
  }
  const { bundle, missing } = buildBundle({ inDir: dir, params: null, client: 'テスト' })
  assert.deepEqual(missing, [])
  assert.equal(typeof bundle.kpi.sessions, 'number')
  assert.equal(typeof bundle.email_product[0].product_id, 'string')
  const { errors } = validateBundle(bundle)
  assert.deepEqual(errors, [])
  const html = renderDashboard(bundle, path.join(SKILL, 'assets', 'dashboard-template.html'))
  assert.ok(html.includes('"format":"td-ec-golden-path-analytics/bundle"'))
  assert.ok(html.includes('<title>テスト ゴールデンパス分析</title>'))
  assert.ok(!html.includes('<script id="gp-data" type="application/json">null</script>'))
})

test('a bundle with a closing script tag in a value cannot break out of the data block', () => {
  const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
  sample.meta.client = '</script><script>alert(1)</script>'
  const html = renderDashboard(sample, path.join(SKILL, 'assets', 'dashboard-template.html'))
  assert.ok(!html.includes('</script><script>alert(1)'))
})

test('validate rejects other formats', () => {
  assert.ok(validateBundle({ format: 'x', version: 1 }).errors.length > 0)
})

test('checkFrequency: the default settings pass and broken ones are reported', () => {
  const p = parseYaml(fs.readFileSync(path.join(WF, 'config', 'params.yml'), 'utf8'))
  assert.deepEqual(checkFrequency(p), [])
  const bad = structuredClone(p)
  bad.frequency_sankey.rank_labels = 'A,B'
  bad.frequency_sankey.amount_bands = '5000,3000'
  bad.frequency_sankey.dimensions = 'category,sku'
  bad.frequency_sankey.multi_mode_default = 'both'
  bad.frequency_sankey.custom_label = "it's"
  const errors = checkFrequency(bad)
  for (const key of ['rank_labels', 'amount_bands', 'sku', 'multi_mode_default', 'custom_label']) {
    assert.ok(errors.some((e) => e.includes(key)), key)
  }
  const custom = structuredClone(p)
  custom.frequency_sankey.dimensions = 'custom'
  assert.ok(checkFrequency(custom).some((e) => e.includes('custom_expr')))
})

test('bundle keeps sankey node names as strings even when they look numeric', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'freq_links.json'), JSON.stringify([{ dimension: 'brand', from_node: '1990', to_node: '2001', weight: '12.5' }]))
  const { bundle } = buildBundle({ inDir: dir, params: null })
  assert.equal(bundle.freq_links[0].from_node, '1990')
  assert.equal(bundle.freq_links[0].weight, 12.5)
})

test('nothing is written inside the private "my" folder', () => {
  const ws = tmp()
  const mine = path.join(ws, 'my')
  assert.equal(privateFolderOf(path.join(mine, 'golden-path', 'x')), mine)
  assert.equal(privateFolderOf(path.join(ws, 'My', 'x')), path.join(ws, 'My'))
  assert.equal(privateFolderOf(path.join(ws, 'mydata', 'x')), undefined, 'only a folder named exactly "my"')
  assert.doesNotThrow(() => assertSharedPath(path.join(ws, 'golden-path', 'reports')))
  assert.throws(() => exportSql('golden_path_mart', path.join(mine, 'sql')), /my/)
  const params = parseYaml(fs.readFileSync(path.join(WF, 'config', 'params.yml'), 'utf8'))
  assert.throws(() => discoverySql(params, path.join(mine, '_discovery')), /my/)
  assert.throws(() => appendMemory(path.join(mine, 'golden-path'), { stage: 'x', summary: 'y' }), /my/)
  assert.ok(!fs.existsSync(mine), 'nothing was created under my/')

  const wf = path.join(mine, 'golden_path')
  fs.cpSync(WF, wf, { recursive: true })
  assert.ok(check(wf).errors.some((e) => /my/.test(e) && /共有/.test(e)))

  assert.throws(() => execFileSync('node', [CLI, 'dashboard', '--bundle', SAMPLE, '--out', path.join(mine, 'd.html')], { stdio: 'pipe' }))
  assert.throws(() => execFileSync('node', [CLI, 'bundle', '--in', ws, '--out', path.join(mine, 'b.json')], { stdio: 'pipe' }))
  assert.ok(!fs.existsSync(path.join(mine, 'd.html')))
})

test('MEMORY.md keeps a chronological work log across people and stages', () => {
  const work = path.join(tmp(), 'golden-path')
  const run = (...argv) => execFileSync('node', [CLI, ...argv], { encoding: 'utf8' })
  run('memory', work, '--by', '山田', '--stage', 'ヒアリング', '--status', '中断', '--summary', 'A〜E まで確定',
    '--decided', '出力DB golden_path_mart\nCV は /thanks', '--open', 'POS の店舗コード（店舗運営に確認）', '--next', 'F から再開', '--at', '2026-10-16 10:00 (+09:00)')
  run('memory', work, '--by', '鈴木', '--stage', 'ヒアリング', '--status', '完了', '--summary', 'F〜I を確定', '--at', '2026-10-17 09:30 (+09:00)')
  assert.throws(() => run('memory', work, '--by', '鈴木', '--stage', 'x'), 'summary is required')
  assert.throws(() => appendMemory(work, { stage: 'x', summary: 'key 1234/abcdefabcdefabcdefabcdefabcdefabcdefabcd' }), /MEMORY/)
  assert.throws(() => appendMemory(work, { stage: 'x', summary: 'taro@example.com に確認' }), /メールアドレス/)

  // dashboard appends one line when its output sits under the work folder
  const out = path.join(work, 'golden_path_reports', '20261017', 'golden-path-dashboard.html')
  run('dashboard', '--bundle', SAMPLE, '--out', out, '--by', '鈴木')
  assert.equal(findWorkDir(out), work)

  const log = fs.readFileSync(path.join(work, 'MEMORY.md'), 'utf8')
  assert.match(log, /^# MEMORY/)
  const a = log.indexOf('2026-10-16 10:00'), b = log.indexOf('2026-10-17 09:30'), c = log.indexOf('ダッシュボード作成')
  assert.ok(a > 0 && a < b && b < c, 'entries are appended oldest first')
  assert.match(log, /担当: 山田/)
  assert.match(log, /### 未解決・要確認\n\n- POS の店舗コード/)
  assert.match(log, /### 決定・確認済み\n\n- 出力DB golden_path_mart\n- CV は \/thanks/)
  assert.match(log, /golden_path_reports\/20261017\/golden-path-dashboard\.html を作成/)
  assert.doesNotMatch(log, /1234\/abcdef|taro@/)

  // a dashboard written outside any work folder does not touch a log
  const elsewhere = path.join(tmp(), 'd.html')
  run('dashboard', '--bundle', SAMPLE, '--out', elsewhere)
  assert.ok(fs.existsSync(elsewhere))
})
