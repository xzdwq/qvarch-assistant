import type { QaContext } from './qaContext'

/** What the page weighs now: rows and nodes in the DOM, an input's delay, the long tasks since last time, the memory (runs in the page). */
const measureProbe = async () => {
  const w = window as unknown as { __qaLong: number[] }
  const rows = document.querySelectorAll('table tbody tr, [role="row"]').length
  const nodes = document.getElementsByTagName('*').length
  const long = w.__qaLong.splice(0)
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
  // an input's delay: a letter typed into the first field, until the page has drawn it
  let delay: number | undefined
  const inp = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')].find((e) => (e as HTMLElement).getClientRects().length > 0) as HTMLInputElement | undefined
  if (inp) {
    const old = inp.value
    const t0 = performance.now()
    inp.value = old + 'x'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    delay = Math.round(performance.now() - t0)
    inp.value = old
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return { rows, nodes, long, mem, delay }
}

/**
 * The action again and again (adding a row) up to `upTo` times: at marks — the rows in the DOM, all the nodes,
 * an input's delay, the browser's long tasks, the memory. All the rows in the DOM and a slow input — a virtual
 * scroll is wanted.
 */
export function loadCheck(ctx: QaContext) {
  const { page, step } = ctx
  return (action: () => Promise<unknown>, o: { upTo?: number; marks?: number[] } = {}) =>
    step('Проверка: нагрузка', async () => {
      const name = 'Нагрузка'
      const upTo = Math.max(1, Math.min(2000, o.upTo ?? 300))
      const marks = [...new Set([...(o.marks ?? [10, 50, 100, 200, 300, 500, 1000]).filter((m) => m < upTo), upTo])].sort((a, b) => a - b)
      await ctx.quiet()
      await page.evaluate(() => {
        const w = window as unknown as { __qaLong: number[] }
        w.__qaLong = []
        try {
          new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__qaLong.push(e.duration))).observe({ type: 'longtask' })
        } catch {
          // no long tasks here
        }
      })
      const measure = () => page.evaluate(measureProbe)
      const base = await measure()
      const rows: string[][] = []
      let done = 0
      let broke = ''
      let last = base
      for (let i = 1; i <= upTo; i++) {
        try {
          await action()
        } catch (e) {
          broke = (e instanceof Error ? e.message : String(e)).split('\n')[0]
          break
        }
        done = i
        if (i % 10 === 0) await ctx.quiet(300, 10000)
        if (marks.includes(i)) {
          await ctx.quiet(500, 15000)
          last = await measure()
          rows.push([String(i), String(last.rows), String(last.nodes), last.delay === undefined ? '—' : String(last.delay), last.long.length ? `${last.long.length} / ${Math.round(Math.max(...last.long))}` : '0', last.mem ? (last.mem / 1048576).toFixed(0) : '—'])
        }
      }
      const head = ['Повторов', 'Строк в DOM', 'Узлов DOM', 'Задержка ввода, мс', 'Долгие задачи (шт / макс, мс)', 'Память, МБ']
      const grew = last.rows - base.rows
      const allIn = done >= 50 && grew >= done * 0.9
      const slow = (last.delay ?? 0) > 100 || last.long.some((d) => d > 200)
      const firstSlow = rows.find((r) => Number(r[3]) > 100)?.[0]
      if (broke && !done) return ctx.verdict({ kind: 'load', name, state: 'fail', summary: `действие не выполнилось ни разу: ${broke}`, head, rows })
      const tail = broke ? ` Остановилось на ${done}-м повторе: ${broke}` : ''
      if (allIn && slow) return ctx.verdict({ kind: 'load', name, state: 'fail', summary: `все ${done} строк в DOM, ввод тормозит${firstSlow ? ` с ~${firstSlow}` : ''} (${last.delay} мс) — нужен виртуальный скролл.${tail}`, head, rows })
      if (allIn) return ctx.verdict({ kind: 'load', name, state: 'warn', summary: `все ${done} строк в DOM (${last.nodes} узлов), пока держится — на больших данных станет медленно: стоит виртуальный скролл или постраничность.${tail}`, head, rows })
      if (slow) return ctx.verdict({ kind: 'load', name, state: 'warn', summary: `строки не копятся в DOM, но ввод медленный (${last.delay} мс) — дело не в количестве строк.${tail}`, head, rows })
      ctx.verdict({ kind: 'load', name, state: broke ? 'warn' : 'ok', summary: `${done} повторов: в DOM ${last.rows} строк, ввод ${last.delay ?? '—'} мс — держится.${tail}`, head, rows })
    })
}
