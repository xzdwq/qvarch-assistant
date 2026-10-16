import { app, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Development only (QA_SNAP=<out dir>, QA_SNAP_HOME=<a copy of the user data>): pictures of the windows, never
 * shown on screen — each step runs some script in a window, waits, and saves that window as <name>.png.
 * Steps come from QA_SNAP_STEPS (a JSON file) — [{ name, win?: 'main' | 'island', js?, wait?, w?, h? }].
 */
interface Step {
  name: string
  win?: 'main' | 'island'
  js?: string
  wait?: number
  w?: number
  h?: number
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runSnap(out: string, main: BrowserWindow, island?: BrowserWindow): Promise<void> {
  mkdirSync(out, { recursive: true })
  const raw = JSON.parse(readFileSync(process.env.QA_SNAP_STEPS ?? '', 'utf8').replace(/^\uFEFF/, '')) as Step | Step[]
  const steps: Step[] = Array.isArray(raw) ? raw : [raw]
  const ready = (w: BrowserWindow) => (w.webContents.isLoading() ? new Promise<void>((r) => w.webContents.once('did-finish-load', () => r())) : Promise.resolve())
  for (const w of [main, island]) w?.webContents.setBackgroundThrottling(false)
  await ready(main)
  if (island) await ready(island)
  // no transitions: a hidden window may never finish one (and Vue waits for it between sections)
  for (const w of [main, island]) await w?.webContents.insertCSS('*, *::before, *::after { transition: none !important; animation-duration: 0s !important }')
  await sleep(1500)
  const log: string[] = []
  for (const s of steps) {
    const w = s.win === 'island' ? island : main
    if (!w) continue
    try {
      if (s.w && s.h) w.setContentSize(s.w, s.h)
      if (s.js) log.push(`${s.name}: ${JSON.stringify(await w.webContents.executeJavaScript(s.js, true))}`)
      await sleep(s.wait ?? 700)
      const img = await w.webContents.capturePage()
      writeFileSync(join(out, `${s.name}.png`), img.toPNG())
    } catch (e) {
      log.push(`${s.name}: ERROR ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  writeFileSync(join(out, 'log.txt'), log.join('\n'))
  app.exit(0)
}
