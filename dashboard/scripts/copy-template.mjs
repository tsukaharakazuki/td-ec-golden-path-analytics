// Copy the single-file build into the skill as the dashboard template, and the sample bundle next to the viewer.
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')
if (!html.includes('<script id="gp-data" type="application/json">null</script>')) throw new Error('data marker missing in build')
const dest = path.resolve(root, '..', 'skills', 'td-ec-golden-path-analytics', 'assets', 'dashboard-template.html')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, html)
console.log(`template -> ${path.relative(process.cwd(), dest)} (${(html.length / 1024).toFixed(0)} KB)`)
