import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Locator, type Page } from 'playwright-core'
import { FIXTURES, type Fixture } from './fixtures'

/**
 * The recorder's locators, checked as a replay uses them: the recorder's own code (recorderDom.ts) runs in a real page
 * (the installed Edge, headless), makes the locator for the element a person acts on, and Playwright runs that
 * locator — it must find exactly that one element; and again after the page grew (more records, a dialog on top).
 */
let browser: Browser
let page: Page
let bundle: string
beforeAll(async () => {
  bundle = (await build({ entryPoints: ['src/preload/recorderDom.ts'], bundle: true, format: 'iife', globalName: '__rec', write: false, platform: 'browser', target: 'es2020' })).outputFiles[0].text
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage()
}, 60_000)
afterAll(async () => {
  await browser?.close()
}, 30_000)

/** The locator the recorder makes for the target, as the recording does for that kind of action. */
async function recordFor(f: Fixture): Promise<string> {
  await page.setContent(`<!doctype html><meta charset="utf-8"><body>${f.html}</body>`)
  await page.addScriptTag({ content: bundle })
  return page.evaluate((kind) => {
    const el = document.querySelector('[data-target="1"]')!
    const r = (window as unknown as { __rec: Record<string, (e: Element) => unknown> }).__rec
    if (kind === 'list') return (r.listFieldLocator(el) as { loc: string }).loc
    if (kind === 'file') return r.fileInputLocator(el) as string
    return r.locatorFor(el) as string
  }, f.kind)
}
/** A locator's code run as the scenario runs it. */
const run = (code: string) => new Function('page', `return ${code}`)(page) as Locator
/** It finds one element — the target (or, for a field's locator, the field holding the target). */
async function findsTarget(code: string): Promise<void> {
  const loc = run(code)
  expect(await loc.count(), code).toBe(1)
  expect(await loc.evaluate((el) => el.matches('[data-target="1"]') || !!el.querySelector('[data-target="1"]')), code).toBe(true)
}

describe('recorder locators: found again — exactly the element acted on', () => {
  for (const f of FIXTURES)
    it(f.name, async () => {
      const code = await recordFor(f)
      if (f.by) expect(code).toMatch(f.by)
      await findsTarget(code)
      if (!f.grow) return
      await page.evaluate(f.grow)
      await findsTarget(code)
    })
})
