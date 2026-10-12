// node --test tests/cli.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DATASETS, buildBundle, check, discoverySql, exportSql, lookup, parseYaml, readRows, renderDashboard, validateBundle,
} from '../skills/td-ec-golden-path-analytics/scripts/gp-cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = path.join(ROOT, 'skills', 'td-ec-golden-path-analytics')
const WF = path.join(SKILL, 'workflow', 'golden_path')
const SAMPLE = path.join(ROOT, 'dashboard', 'public', 'sample-bundle.json')
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
