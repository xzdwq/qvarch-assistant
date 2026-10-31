import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { expect as pwExpect } from 'playwright/test'
import { openCdpBridge, type BridgeSource } from '../../src/main/runner/cdpBridgeServer'
import { testDir } from '../testTemp'

/**
 * A scenario run through the bridge as the app runs it in its own browser: the page lent is a real one (a headless
 * Edge's page, reached as Electron reaches a tab — one protocol connection to the page, its iframes on sessions of
 * their own), Playwright connects to the bridge (connectOverCDP) and drives it; after it — the page as it was.
 */
let host: BrowserContext
let lent: Page
let dir: string
/** The protocol connection to the lent page (as webContents.debugger is). */
let source: BridgeSource
let raw: WebSocket

beforeAll(async () => {
  dir = testDir('bridge-')
  host = await chromium.launchPersistentContext(dir, { channel: 'msedge', headless: true, args: ['--remote-debugging-port=0'], viewport: null })
  lent = host.pages()[0] ?? (await host.newPage())
  const [port, path] = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n')
  raw = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise((ok) => raw.once('open', ok))
  let seq = 0
  const waits = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>()
  const listeners = new Set<(m: string, p: Record<string, unknown>, s?: string) => void>()
  let pageSession = ''
  raw.on('message', (d) => {
    const m = JSON.parse(String(d))
    if (m.id && waits.has(m.id)) {
      const w = waits.get(m.id)!
      waits.delete(m.id)
      return m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
    if (!m.method || !m.sessionId) return
    for (const l of listeners) l(m.method, m.params ?? {}, m.sessionId === pageSession ? undefined : m.sessionId)
  })
  const call = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((ok, fail) => {
      const id = ++seq
      waits.set(id, { ok, fail })
      raw.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  const { targetInfos } = await call('Target.getTargets')
  const t = targetInfos.find((x: { type: string }) => x.type === 'page')
  pageSession = (await call('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId
  const version = await call('Browser.getVersion')
  source = {
    send: (method, params, sessionId) => call(method, params, sessionId ?? pageSession),
    target: async () => ({ targetId: t.targetId, url: lent.url(), title: '', product: version.product, userAgent: version.userAgent }),
    onEvent: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    onGone: () => () => undefined,
  }
}, 60_000)
afterAll(async () => {
  raw?.close()
  await host?.close()
  rmSync(dir, { recursive: true, force: true })
}, 30_000)

const PAGE = `<!doctype html><meta charset="utf-8"><title>Форма</title>
<label>Имя <input id="n"></label><button onclick="out.textContent = 'Привет, ' + n.value">Поздороваться</button><p id="out"></p>
<iframe srcdoc="<button>Внутри</button>"></iframe>`

describe('the bridge with Playwright', () => {
  it('runs a scenario in the lent page; refuses a new tab; leaves the page as it was', async () => {
    const width = await lent.evaluate(() => innerWidth)
    const bridge = await openCdpBridge(source)
    const browser = await chromium.connectOverCDP(bridge.url, { isLocal: true, timeout: 20_000 })
    const context = browser.contexts()[0]
    const page = context.pages()[0]
    expect(page).toBeTruthy()
    await page.setContent(PAGE)
    await page.getByLabel('Имя').fill('Мир')
    await page.getByRole('button', { name: 'Поздороваться' }).click()
    await pwExpect(page.locator('#out')).toHaveText('Привет, Мир')
    await page.frameLocator('iframe').getByRole('button', { name: 'Внутри' }).click()
    // the run's own window size (qa.window) — and a session of its own on the page (qa.layout's way)
    await page.setViewportSize({ width: 375, height: 600 })
    expect(await page.evaluate(() => innerWidth)).toBe(375)
    const cdp = await context.newCDPSession(page)
    expect((await cdp.send('Runtime.evaluate', { expression: '6*7', returnByValue: true })).result.value).toBe(42)
    await expect(context.newPage()).rejects.toThrow(/новую он не открывает/)
    await context.tracing.start({ screenshots: true, snapshots: true })
    await page.getByRole('button', { name: 'Поздороваться' }).click()
    await context.tracing.stop({ path: join(dir, 'trace.zip') })
    await browser.close()
    await bridge.done
    // the page as it was: its own width, nothing intercepted
    expect(await lent.evaluate(() => innerWidth)).toBe(width)
    expect(await lent.locator('#out').textContent()).toBe('Привет, Мир')
  }, 60_000)

  // (a second run in the same page: its protocol was enabled by the run before — the page still tells its contexts)
  it('keeps a run going past the wait for its connection; a second run in the page works', async () => {
    const bridge = await openCdpBridge(source, 1000)
    const browser = await chromium.connectOverCDP(bridge.url, { isLocal: true, timeout: 20_000 })
    const page = browser.contexts()[0].pages()[0]
    // (longer than the wait for the connection: a run is not cut by it)
    await page.waitForTimeout(2500)
    expect(await page.evaluate(() => 6 * 7)).toBe(42)
    expect(page.isClosed()).toBe(false)
    await browser.close()
    await bridge.done
  }, 30_000)

  it('shuts its door when nobody comes, and lets in no one with a wrong secret', async () => {
    const bridge = await openCdpBridge(source, 300)
    await expect(chromium.connectOverCDP(bridge.url.replace(/\/[^/]+$/, '/wrong'), { timeout: 3000 })).rejects.toThrow()
    await bridge.done
    await expect(chromium.connectOverCDP(bridge.url, { timeout: 3000 })).rejects.toThrow()
  }, 30_000)
})
