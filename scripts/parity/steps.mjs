// The parity steps: each section of the app opened in the hidden snapshot run and its styles dumped (the page, and
// the hover states of what reacts to the mouse). Writes the steps JSON for QA_SNAP_STEPS.
// Usage: node scripts/parity/steps.mjs <out.json> [section ...]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DUMP = readFileSync(join(here, 'dump.js'), 'utf8')
/** What reacts to the mouse (held hovered one by one). */
const HOVER = 'button, a, tr, li, label, summary, [role=button], [draggable=true], .nb, .cm-ev, .tab'
/** The dump installed in the page (a script: its last expression is the step's result). */
const install = `${DUMP}\ntrue`
const dumpPage = `${DUMP}\nwindow.__parity.dump()`
/** A section opened by its menu button (its label). */
const open = (label) => `(() => { const b = document.querySelector('[aria-label="${label}"]'); b?.click(); return !!b })()`
const SECTIONS = {
  work: { label: 'Моя работа' },
  // (a tall window: the editor draws only what is on screen — every block of the note is drawn)
  notebook: { label: 'Блокнот', then: `(() => { const e = [...document.querySelectorAll('*')].find((x) => !x.children.length && x.textContent.trim() === 'Проверка'); e?.click(); return !!e })()`, wait: 6000, w: 1400, h: 6000 },
  // (its data comes from git — given time to settle)
  release: { label: 'Релиз', then: 'true', wait: 3000 },
  browser: { label: 'Браузер' },
  http: { label: 'HTTP' },
  terminal: { label: 'Терминал' },
  tools: { label: 'Инструменты' },
  settings: { label: 'Настройки' },
}
const out = process.argv[2]
const only = process.argv.slice(3)
const steps = [{ name: 'install', js: install, wait: 300 }]
for (const [id, s] of Object.entries(SECTIONS)) {
  if (only.length && !only.includes(id)) continue
  // (every section in the same window size: the note's tall one is set back)
  steps.push({ name: `${id}-open`, js: open(s.label), wait: 1200, w: s.w ?? 1400, h: s.h ?? 900 })
  if (s.then) steps.push({ name: `${id}-then`, js: s.then, wait: s.wait ?? 1200 })
  steps.push({ name: id, js: dumpPage, save: true, hover: { selector: HOVER, js: `(i) => window.__parity.dumpOf(${JSON.stringify(HOVER)}, i)` }, wait: 100 })
}
if (!only.length || only.includes('island')) steps.push({ name: 'island', win: 'island', js: dumpPage, save: true, hover: { selector: HOVER, js: `(i) => window.__parity.dumpOf(${JSON.stringify(HOVER)}, i)` }, wait: 100 })
writeFileSync(out, JSON.stringify(steps, null, 2))
console.log(`${steps.length} steps → ${out}`)
