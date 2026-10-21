import { app, WebContentsView, type BrowserWindow } from 'electron'
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
  /** Runs in the first visible browser page (a WebContentsView) — after js. */
  vjs?: string
  /** Real (trusted) input into that page, in order: a click at the centre of a CSS selector, typed text, a key. */
  vinput?: Array<{ click?: string; dbl?: string; type?: string; key?: string; wait?: number }>
  /** A mouse moved across the window (x, y → x, y in n steps): every cursor change of the window and its pages is logged. */
  move?: [number, number, number, number, number]
  /**
   * Real strokes drawn with the mouse on the window (after js): the points around the centre of `sel`; held still
   * `hold` ms at the end before the button goes up.
   */
  strokes?: Array<{ sel: string; pts: Array<[number, number]>; hold?: number }>
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
  // QA_SNAP_SHOW: the main window is drawn for real (the browser's pages paint only in a shown window) — fully
  // transparent, clicks pass through it, no focus, no taskbar button: nothing appears, nothing is taken from the user
  if (process.env.QA_SNAP_SHOW) {
    main.setSkipTaskbar(true)
    main.setOpacity(0)
    main.setIgnoreMouseEvents(true)
    main.showInactive()
  }
  await sleep(1500)
  const log: string[] = []
  for (const s of steps) {
    const w = s.win === 'island' ? island : main
    if (!w) continue
    try {
      if (s.w && s.h) w.setContentSize(s.w, s.h)
      if (s.js) log.push(`${s.name}: ${JSON.stringify(await w.webContents.executeJavaScript(s.js, true))}`)
      if (s.move) {
        const [x0, y0, x1, y1, n] = s.move
        const seen: string[] = []
        const all = [w.webContents, ...w.contentView.children.filter((x): x is WebContentsView => x instanceof WebContentsView).map((v) => v.webContents)]
        const offs = all.map((wc, k) => {
          const h = (_e: unknown, type: string) => seen.push(`${k === 0 ? 'app' : 'view' + k}:${type}`)
          wc.on('cursor-changed', h)
          return () => wc.off('cursor-changed', h)
        })
        for (let i = 0; i <= n; i++) {
          w.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x0 + ((x1 - x0) * i) / n), y: Math.round(y0 + ((y1 - y0) * i) / n) })
          await sleep(25)
        }
        await sleep(200)
        offs.forEach((f) => f())
        log.push(`${s.name} cursors: ${seen.join(' ')}`)
      }
      for (const st of s.strokes ?? []) {
        const c = (await w.webContents.executeJavaScript(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(st.sel)})].pop(); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()`)) as [number, number] | null
        if (!c) {
          log.push(`${s.name}: no ${st.sel}`)
          continue
        }
        const at = (p: [number, number]) => ({ x: Math.round(c[0] + p[0]), y: Math.round(c[1] + p[1]) })
        w.webContents.sendInputEvent({ type: 'mouseMove', ...at(st.pts[0]) })
        w.webContents.sendInputEvent({ type: 'mouseDown', ...at(st.pts[0]), button: 'left', clickCount: 1 })
        for (const p of st.pts.slice(1)) {
          w.webContents.sendInputEvent({ type: 'mouseMove', ...at(p), modifiers: ['leftbuttondown'] })
          await sleep(8)
        }
        await sleep(st.hold ?? 0)
        w.webContents.sendInputEvent({ type: 'mouseUp', ...at(st.pts[st.pts.length - 1]), button: 'left', clickCount: 1 })
        await sleep(300)
      }
      if (s.vinput) {
        const v = w.contentView.children.find((x): x is WebContentsView => x instanceof WebContentsView && x.getVisible())
        const wc = v?.webContents
        for (const a of s.vinput) {
          if (!wc) break
          if (a.dbl) {
            const r = (await wc.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(a.dbl)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()`)) as [number, number] | null
            if (r) {
              const [x, y] = r.map(Math.round)
              wc.sendInputEvent({ type: 'mouseMove', x, y })
              for (const n of [1, 2]) {
                wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: n })
                wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: n })
              }
            } else log.push(`${s.name}: no ${a.dbl}`)
          }
          if (a.click) {
            const r = (await wc.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(a.click)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()`)) as [number, number] | null
            if (!r) log.push(`${s.name}: no ${a.click}`)
            else {
              const [x, y] = r.map(Math.round)
              wc.sendInputEvent({ type: 'mouseMove', x, y })
              wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
              wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
            }
          }
          if (a.type) for (const ch of a.type) wc.sendInputEvent({ type: 'char', keyCode: ch })
          if (a.key) {
            wc.sendInputEvent({ type: 'keyDown', keyCode: a.key })
            if (a.key === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' })
            wc.sendInputEvent({ type: 'keyUp', keyCode: a.key })
          }
          await sleep(a.wait ?? 250)
        }
      }
      if (s.vjs) {
        const v = w.contentView.children.find((x): x is WebContentsView => x instanceof WebContentsView && x.getVisible())
        log.push(`${s.name} (page): ${v ? JSON.stringify(await v.webContents.executeJavaScript(s.vjs, true)) : 'no page'}`)
      }
      await sleep(s.wait ?? 700)
      const img = await w.webContents.capturePage()
      writeFileSync(join(out, `${s.name}.png`), img.toPNG())
      // the browser's pages are views of their own (not in the window's picture): each visible one apart
      for (const [i, v] of w.contentView.children.entries()) {
        if (!(v instanceof WebContentsView) || !v.getVisible()) continue
        const b = v.getBounds()
        writeFileSync(join(out, `${s.name}.view${i}.png`), (await v.webContents.capturePage()).toPNG())
        log.push(`${s.name}: view${i} at ${b.x},${b.y} ${b.width}x${b.height}`)
      }
    } catch (e) {
      log.push(`${s.name}: ERROR ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  writeFileSync(join(out, 'log.txt'), log.join('\n'))
  app.exit(0)
}
