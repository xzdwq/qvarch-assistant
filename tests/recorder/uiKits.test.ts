import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { UI, UI_KITS, UI_ROLES, selectorOf, selectorParts, xpathTest } from '../../src/shared/browser/uiKits'

/**
 * The UI kits' registry: every role a valid, non-empty selector (checked by a real page's own parser), and no kit's
 * class anywhere in the recorder or the checks but the registry — they find parts by role only.
 */
let browser: Browser
let page: Page
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage()
}, 60_000)
afterAll(async () => {
  await browser?.close()
}, 30_000)

/** Whether the page's parser takes the selector (querySelectorAll throws on a bad one). */
const parses = (sel: string) =>
  page.evaluate((s) => {
    try {
      document.querySelectorAll(s)
      return true
    } catch {
      return false
    }
  }, sel)

describe('UI kits: every role a valid selector', () => {
  it('each role of the union — non-empty and parsed', async () => {
    for (const r of UI_ROLES) {
      expect(UI[r].trim(), r).not.toBe('')
      expect(await parses(UI[r]), `${r}: ${UI[r]}`).toBe(true)
    }
  })
  it('each kit part — parsed on its own', async () => {
    for (const k of UI_KITS)
      for (const [r, sel] of Object.entries(k.roles)) for (const p of selectorParts(sel ?? '')) expect(await parses(p), `${k.name}.${r}: ${p}`).toBe(true)
  })
  it('a field and its label as XPath (the recorder writes them so) — evaluated', async () => {
    for (const sel of [UI.field, UI.fieldLabel]) {
      const ok = await page.evaluate((x) => {
        try {
          document.evaluate(`//*[${x}]`, document, null, XPathResult.ANY_TYPE, null)
          return true
        } catch {
          return false
        }
      }, xpathTest(sel))
      expect(ok, sel).toBe(true)
    }
    expect(() => xpathTest('.a .b')).toThrow()
  })
  it('selectorOf: the parts the element itself answers to, else the whole role', () => {
    const el = (classes: string[]) => ({ matches: (s: string) => classes.some((c) => s === c) })
    const part = selectorParts(UI.menu).at(-1)!
    expect(selectorOf(el([part]), 'menu')).toBe(part)
    expect(selectorOf(el([]), 'menu')).toBe(UI.menu)
  })
})

/** The recorder and the checks (the files that must find parts by role). */
const AREA = ['src/preload/pwRecorder.ts', 'src/preload/recorderDom.ts', 'src/preload/recorder', 'src/main/runner/qa', 'src/main/runner/qaRuntime.ts']
const filesIn = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((n) => filesIn(join(p, n))) : p.endsWith('.ts') ? [p] : [])
/** A kit's own class names (a plain word like «show» is too common to look for). */
const KIT_CLASSES = [...new Set(UI_KITS.filter((k) => k.name !== 'html').flatMap((k) => Object.values(k.roles).flatMap((s) => [...(s ?? '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]))))].filter((c) => /[-_]/.test(c))

describe('UI kits: no kit class outside the registry', () => {
  for (const f of AREA.flatMap(filesIn))
    it(f, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/['"`\s,(]\.(q|el|ant)-[a-z]/)
      for (const c of KIT_CLASSES) expect(src.includes(c), `${f}: ${c}`).toBe(false)
    })
})
