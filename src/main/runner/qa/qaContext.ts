import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CDPSession, Page } from 'playwright-core'
import { PageScreen } from '../pageScreen'
import { revealPage, rollPageBack, unrollPage } from './pageUnroll'
import { PAGE_MARK } from '../../../shared/browser/pageMarks'
import { UI } from '../../../shared/browser/uiKits'
import type { QaCheck } from '../../../shared/qaChecks'
import { MUT, Traffic, type Exchange } from '../traffic'
import { hintProbe, layoutProbe, pageFieldsProbe, type Flaw } from './pageProbes'

export type Step = <T>(name: string, fn: () => Promise<T> | T) => Promise<T>
/** A layout fault counted over the screens: its kind, its words, the screens it showed on. */
export type SeenFlaws = Map<string, { kind: string; text: string; where: string[] }>

/**
 * One run of a Playwright block as its `qa` checks see it: the page, its traffic (every request, in order), its JS
 * errors, the checks written down — and what every check needs: the page settled, a verdict, a test file, a snapshot
 * of the fields, a picture with the layout's faults.
 */
export class QaContext {
  /** The run's traffic (every request, in order); which of them a result rests on — an outcome adapter's choice. */
  readonly traffic: Traffic
  readonly sent: Exchange[]
  /** JS errors of the page (their time; a run per file says which came during it). */
  readonly pageErrors: Array<{ at: number; text: string }> = []
  /** Snapshots remembered by name (the context check). */
  readonly snaps = new Map<string, Record<string, string>>()

  constructor(
    readonly page: Page,
    readonly step: Step,
    readonly checks: QaCheck[],
    readonly dir: string,
    readonly filesRoot: string,
    /** How the page's screen is set (its site's zoom made up for). */
    readonly screen: PageScreen = new PageScreen(page),
  ) {
    this.traffic = new Traffic(page)
    this.sent = this.traffic.list
    page.on('pageerror', (e) => {
      this.pageErrors.push({ at: Date.now(), text: (e.message || String(e)).split('\n')[0].slice(0, 200) })
      // (a page throwing in a loop: the newest kept)
      if (this.pageErrors.length > 200) this.pageErrors.splice(0, 100)
    })
  }
  /** A request to the site's API (not a picture, a script…). */
  readonly api = Traffic.data
  /** «Набор/файл» of the notebook's test files → its path (nothing outside their folder). */
  fileOf(rel: string): string {
    const parts = String(rel).split(/[\\/]/).filter(Boolean)
    if (!this.filesRoot) throw new Error('qa.file: папка тестовых файлов неизвестна')
    if (parts.length !== 2 || parts.some((p) => p.startsWith('.') || /[:*?"<>|]/.test(p))) throw new Error(`qa.file('${rel}'): ожидается 'Набор/файл'`)
    const p = join(this.filesRoot, parts[0], parts[1])
    if (!existsSync(p)) throw new Error(`Нет тестового файла «${rel}» — он удалён или переименован в «Тестовых файлах»`)
    return p
  }
  /** The page settled: no request of its own on the way for `idle` ms (at most `max`). */
  async quiet(idle = 700, max = 20000): Promise<void> {
    const t0 = Date.now()
    let last = Date.now()
    while (Date.now() - t0 < max) {
      if (this.sent.some(Traffic.busy)) last = Date.now()
      else if (Date.now() - last >= idle) break
      await this.page.waitForTimeout(100)
    }
    // the statuses come a moment after «finished»
    await this.page.waitForTimeout(150)
  }
  /** Waits until `ready` holds (looked at every `every` ms, at most `max` ms); whether it came. */
  async until(ready: () => boolean | Promise<boolean>, max: number, every = 100): Promise<boolean> {
    const t0 = Date.now()
    while (Date.now() - t0 < max) {
      if (await ready()) return true
      await this.page.waitForTimeout(every)
    }
    return false
  }
  /** The changes (POST / PUT / PATCH / DELETE) to the API sent since `from`. */
  mutations(from: number): Exchange[] {
    return this.sent.slice(from).filter((x) => MUT.test(x.method) && this.api(x))
  }
  /** A check written down; a failed one stops the run (as a failed expect). */
  verdict(c: QaCheck): void {
    this.checks.push(c)
    if (c.state === 'fail') throw new Error(`Проверка «${c.name}» не прошла: ${c.summary}`)
  }
  /** What the page shows: its fields (by their labels) and its tables' rows. */
  snap(): Promise<Record<string, string>> {
    return this.page.evaluate(pageFieldsProbe, UI)
  }
  /** What the page tells now: field errors, alerts, notifications. */
  async hints(): Promise<string[]> {
    return (await this.page.evaluate(hintProbe, UI).catch(() => [])) as string[]
  }
  /** The tables' rows seen now. */
  rowsNow(): Promise<number> {
    return this.page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter((e) => (e as HTMLElement).getClientRects().length > 0).length)
  }
  /**
   * The page as it is now: its layout faults (each counted into `seen` by its kind and words, the screen noted), the
   * faults outlined on a picture of it (the outlines taken off after). Returns this screen's faults.
   */
  async shoot(cdp: CDPSession, file: string, where: string, seen: SeenFlaws): Promise<Flaw[]> {
    const page = this.page
    // the page drawn all the way down first (what it draws only once scrolled to), then — an app scrolling a box of its
    // own — that box laid out whole: the measure and the picture take the whole page; put back after
    await page.evaluate(revealPage).catch(() => undefined)
    const unrolled = await page.evaluate(unrollPage).catch(() => false)
    try {
      const r = ((await page.evaluate(layoutProbe, UI).catch(() => undefined)) as { hscroll: number; items: Flaw[] } | undefined) ?? { hscroll: 0, items: [] }
      const flaws = [...r.items, ...(r.hscroll ? [{ kind: 'Прокрутка вбок', text: `страница шире окна на ${r.hscroll}px`, x: 0, y: 0, w: 0, h: 0 }] : [])]
      for (const x of flaws) {
        // (a page wider than the window — one finding, its widest overrun)
        const k = x.kind === 'Прокрутка вбок' ? x.kind : `${x.kind}|${x.text}`
        const e = seen.get(k) ?? { kind: x.kind, text: x.text, where: [] }
        if (x.kind === 'Прокрутка вбок') e.text = `страница шире окна (до ${Math.max(r.hscroll, Number(/\d+/.exec(e.text)?.[0] ?? 0))}px)`
        e.where.push(where)
        seen.set(k, e)
      }
      await page
        .evaluate(
          ({ boxes, mark }: { boxes: Flaw[]; mark: typeof PAGE_MARK }) => {
            const layer = document.createElement('div')
            layer.id = '__qa_layout'
            layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none'
            // (on the page first: a word's width is known only there)
            document.body.appendChild(layer)
            for (const b of boxes) {
              if (!b.w || !b.h) continue
              const d = document.createElement('div')
              d.style.cssText = `position:absolute;left:${b.x - 2}px;top:${b.y - 2}px;width:${b.w + 4}px;height:${b.h + 4}px;border:2px solid ${mark.line};border-radius:3px;background:${mark.fill}`
              // what is wrong — on the outline itself
              const tag = document.createElement('span')
              tag.textContent = b.kind
              tag.style.cssText = `position:absolute;left:-2px;top:-18px;padding:1px 5px;border-radius:3px;background:${mark.line};color:${mark.onLine};font:600 11px/15px system-ui,sans-serif;white-space:nowrap`
              d.appendChild(tag)
              layer.appendChild(d)
              // (a word that would run past the screen's right edge — held to the outline's right side instead)
              if (b.x - 2 - scrollX + tag.offsetWidth > innerWidth) ((tag.style.left = 'auto'), (tag.style.right = '-2px'))
            }
          },
          { boxes: r.items, mark: PAGE_MARK },
        )
        .catch(() => undefined)
      // the whole page down (the faults below the first screen seen too), as wide as the screen — no wider
      const size = (await page.evaluate(() => ({ w: innerWidth, h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) })).catch(() => undefined)) ?? { w: 0, h: 0 }
      // (the region in the screen's own pixels: the site's zoom — as the screen was set — counted)
      const z = this.screen.zoom
      const clip = size.w && size.h ? { x: 0, y: 0, width: size.w * z, height: Math.min(size.h, PICTURE_MAX_H) * z, scale: 1 } : undefined
      const pic = (await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : { captureBeyondViewport: false }) }).catch(() => undefined)) as
        { data: string } | undefined
      if (pic) writeFileSync(join(this.dir, file), Buffer.from(pic.data, 'base64'))
      await page.evaluate(() => document.getElementById('__qa_layout')?.remove()).catch(() => undefined)
      return flaws
    } finally {
      if (unrolled) await page.evaluate(rollPageBack).catch(() => undefined)
    }
  }
}
/** A layout picture's height at most, CSS px (a very long page is cut there — its faults are still in the table). */
const PICTURE_MAX_H = 12000

/** An answer 2xx. */
export const ok2 = (x: Exchange) => !!x.status && x.status >= 200 && x.status < 300
