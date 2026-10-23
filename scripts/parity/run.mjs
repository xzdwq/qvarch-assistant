// A hidden snapshot run of the built app (out/) on a fresh synthetic profile: its sections' styles dumped into <out>.
// Nothing is shown on screen, the person's data is never touched (QA_SNAP_HOME — a temp copy of the fixture).
// Usage: node scripts/parity/run.mjs <out dir> [section ...]   (build first: npm run build)
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = resolve(process.argv[2] ?? join(tmpdir(), 'qvarch-parity'))
const sections = process.argv.slice(3)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
// a fresh profile: the fixture's notes; settings / days made by the app itself
const home = mkdtempSync(join(tmpdir(), 'qvarch-parity-home-'))
cpSync(join(here, 'fixture'), join(home, 'data'), { recursive: true })
const steps = join(out, 'steps.json')
await new Promise((ok, fail) => spawn(process.execPath, [join(here, 'steps.mjs'), steps, ...sections], { stdio: 'inherit' }).on('exit', (c) => (c ? fail(new Error(`steps: ${c}`)) : ok())))
const electron = createRequire(import.meta.url)('electron')
const t0 = Date.now()
const code = await new Promise((ok) => {
  // (an editor's terminal may say «run Electron as Node» — the app must run as itself)
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env
  const p = spawn(electron, [root], { env: { ...env, QA_SNAP: out, QA_SNAP_HOME: home, QA_SNAP_STEPS: steps }, stdio: 'inherit' })
  const kill = setTimeout(() => p.kill(), 10 * 60_000)
  p.on('exit', (c) => (clearTimeout(kill), ok(c)))
})
rmSync(home, { recursive: true, force: true })
console.log(`snapshot run: exit ${code} in ${Math.round((Date.now() - t0) / 1000)} s → ${out}`)
process.exit(code ?? 1)
