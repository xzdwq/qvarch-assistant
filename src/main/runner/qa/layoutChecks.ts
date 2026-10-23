import type { QaCheck } from '../../../shared/qaChecks'
import type { QaContext, SeenFlaws } from './qaContext'
import { stepError } from './qaText'
import type { QaMark } from '../../../shared/browser/constants'

/** The screens a layout check looks at: widths × zooms, at one height. */
type Screens = { widths?: number[]; zooms?: number[]; height?: number }

/** `qa` checks of the layout: the page on other screens, the whole scenario on each screen. */
export function layoutChecks(ctx: QaContext) {
  const { page, step } = ctx
  return {
    /**
     * The page as it is now on other screens: widths × the browser's zoom (a zoom Z — the page sees Z% fewer CSS
     * pixels and Z% more density). The faults are outlined on a picture of each; the window goes back after.
     */
    layout: (o: Screens = {}) =>
      step('Проверка: вёрстка на разных экранах', async () => {
        const name = 'Вёрстка на разных экранах'
        // nothing to look at: a blank tab (the scenario never opened a page, or left it)
        if (page.url().startsWith('about:'))
          return ctx.verdict({ kind: 'layout', name, state: 'warn', summary: `вкладка пустая (${page.url()}) — проверять нечего: поставьте вёрстку после строки, где открыта нужная страница` })
        const widths = o.widths ?? [375, 768, 1280, 1920]
        const zooms = o.zooms ?? [80, 100, 125]
        const H = o.height ?? 900
        const was = page.viewportSize()
        const cdp = await page.context().newCDPSession(page)
        await ctx.quiet()
        const shots: NonNullable<QaCheck['shots']> = []
        const seen: SeenFlaws = new Map()
        try {
          for (const w of widths)
            for (const z of zooms) {
              const cw = Math.round((w * 100) / z)
              const ch = Math.round((H * 100) / z)
              await cdp.send('Emulation.setDeviceMetricsOverride', { width: cw, height: ch, deviceScaleFactor: z / 100, mobile: false })
              await page.waitForTimeout(400)
              await ctx.quiet(300, 5000)
              const where = `${w} px · ${z}%`
              const file = `layout-${w}x${H}-${z}.png`
              const flaws = await ctx.shoot(cdp, file, where, seen)
              shots.push({ file, label: where, bad: flaws.length })
            }
        } finally {
          await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
          if (was) await page.setViewportSize(was).catch(() => undefined)
        }
        const list = [...seen.values()]
        const rows = list.slice(0, 40).map((x) => [x.kind, x.text, x.where.length === shots.length ? 'на всех' : x.where.join(', ')])
        if (list.length) return ctx.verdict({ kind: 'layout', name, state: 'fail', summary: `найдено проблем: ${list.length} (на ${shots.filter((x) => x.bad).length} из ${shots.length} экранов)`, head: ['Что', 'Где на странице', 'Экраны'], rows, shots })
        ctx.verdict({ kind: 'layout', name, state: 'ok', summary: `${shots.length} экранов — без прокрутки вбок, вылезающего и обрезанного текста, перекрытий`, shots })
      }),

    /**
     * The whole scenario on each screen: run anew in a window of each width (× zoom); where it ends — the layout
     * looked at and a picture; a step it could not do there (a button gone into a menu on a narrow screen) — said,
     * with a picture of where it stopped, and the next screen goes on.
     */
    layoutEach: (o: Screens, run: () => Promise<unknown>) =>
      step('Проверка: весь сценарий на каждом экране', async () => {
        const name = 'Вёрстка: весь сценарий на каждом экране'
        const widths = o.widths ?? [375, 768, 1280, 1920]
        const zooms = o.zooms ?? [100]
        const H = o.height ?? 900
        const was = page.viewportSize()
        const cdp = await page.context().newCDPSession(page)
        const shots: NonNullable<QaCheck['shots']> = []
        const seen: SeenFlaws = new Map()
        const rows: string[][] = []
        const marks: QaMark[] = []
        // a step that cannot be done on this screen says so in seconds, not in half a minute
        page.setDefaultNavigationTimeout(30000)
        page.setDefaultTimeout(8000)
        try {
          for (const w of widths)
            for (const z of zooms) {
              const cw = Math.round((w * 100) / z)
              const ch = Math.round((H * 100) / z)
              // 100% — the window itself (the scenario's clicks land as on a real one); a zoom — the density emulated
              await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
              await page.setViewportSize({ width: cw, height: ch })
              if (z !== 100) await cdp.send('Emulation.setDeviceMetricsOverride', { width: cw, height: ch, deviceScaleFactor: z / 100, mobile: false })
              const where = `${w} px · ${z}%`
              let error: string | undefined
              await step(where, async () => {
                try {
                  await run()
                } catch (e) {
                  // «Timeout exceeded» says little: what it waited for (Playwright's call log names it)
                  error = stepError(e, 8)
                }
              })
              await ctx.quiet(300, 4000)
              const file = `layout-${w}x${H}-${z}.png`
              const flaws = await ctx.shoot(cdp, file, where, seen)
              shots.push({ file, label: error ? `${where} · не прошёл` : where, bad: flaws.length + (error ? 1 : 0) })
              const said = [...new Set(flaws.map((x) => `${x.kind}: ${x.text}`))].slice(0, 3).join('; ')
              rows.push([where, error ? 'Сценарий не прошёл' : flaws.length ? `Проблем: ${flaws.length}` : 'Без замечаний', error ? `шаг не выполнился: ${error}${said ? `; на странице: ${said}` : ''}` : said])
              marks.push(flaws.length ? 'fail' : error ? 'warn' : 'ok')
            }
        } finally {
          await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
          if (was) await page.setViewportSize(was).catch(() => undefined)
          page.setDefaultTimeout(30000)
        }
        const failed = rows.filter((r) => r[1] === 'Сценарий не прошёл').length
        const bad = marks.filter((m) => m === 'fail').length
        const summary = `экранов ${rows.length}${failed ? `, сценарий не прошёл на ${failed}` : ''}${bad ? `, проблемы вёрстки на ${bad}` : ''}${!failed && !bad ? ' — сценарий прошёл везде, без прокрутки вбок, вылезающего и обрезанного текста, перекрытий' : ''}`
        ctx.verdict({ kind: 'layout', name, state: bad ? 'fail' : failed ? 'warn' : 'ok', summary, head: ['Экран', 'Итог', 'Подробно'], rows, marks, shots })
      }),
  }
}
