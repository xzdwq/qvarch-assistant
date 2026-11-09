import type { QaMark } from './browser/constants'
import { UI_METRICS, type QaCheck } from './qaChecks'

/**
 * How the page answered the person, apart from the server: each input / key / click measured by the browser (Event
 * Timing — the delay before its handlers, the handlers, the paint after: what INP is made of) and the long frames
 * (Long Animation Frames — over 50 ms, with the scripts that held them). Gathered in the page through a run, summed up
 * here into one result entry beside the checks: the worst ones, on which step and field, and who held the frames.
 */

/** An event the browser measured (16 ms and longer). `at` — when (epoch ms); `id` — its interaction (0 — none: input). */
export interface UiEvent {
  name: string
  d: number
  delay: number
  proc: number
  at: number
  id: number
  target: string
}
/** A script that held a long frame: where (file:position), its function, what called it, how long. */
export interface UiScript {
  src: string
  fn: string
  inv: string
  d: number
}
export interface UiFrame {
  d: number
  block: number
  at: number
  scripts: UiScript[]
}
/** What the page sent: the measured events, the long frames, every input / key / click counted. */
export interface UiSamples {
  events: UiEvent[]
  frames: UiFrame[]
  counts: { keys: number; inputs: number; clicks: number }
}
export const emptyUiSamples = (): UiSamples => ({ events: [], frames: [], counts: { keys: 0, inputs: 0, clicks: 0 } })

/** INP's lines: up to 200 ms — good; up to 500 — needs work; past it — poor. An event past SLOW_MS is counted slow. */
export const UI_GOOD_MS = 200
export const UI_POOR_MS = 500
const SLOW_MS = 100
const ROWS_SHOWN = 15
const CULPRITS_SHOWN = 6

/** A step of the run (its name, when it started, how long it went, how deep). */
export interface UiStep {
  name: string
  start: number
  ms?: number
  depth: number
}
/** The deepest step going on at `at` (none — between steps). */
function stepAt(steps: readonly UiStep[], at: number): string {
  let hit: UiStep | undefined
  for (const s of steps) if (at >= s.start && at <= s.start + (s.ms ?? Infinity) && (!hit || s.depth >= hit.depth)) hit = s
  return hit?.name ?? ''
}
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} с` : `${Math.round(n)} мс`)
/** Where a script is, short: its function, its file's name and position (a script of the page itself — said so). */
function scriptName(s: UiScript): string {
  const file = s.src.split(/[?#]/)[0].split('/').pop() ?? ''
  return [s.fn, !file || file.startsWith(':') ? `встроенный скрипт${file}` : file].filter(Boolean).join(' · ')
}

/** The entries of one key / click / input begin together (one task dispatches them all): this close, on one field. */
const SAME_ACT_MS = 10
/**
 * One interaction — a key (keydown, keypress, beforeinput, input), a click, a typed-in text: when it began, on what;
 * how long until it was painted (from its first entry to its last one's end); the delay before its first handler;
 * its handlers' time — their spans joined (an input's handlers run inside its key's keypress: never counted twice).
 */
interface Interaction {
  at: number
  target: string
  d: number
  delay: number
  proc: number
  names: string[]
  id: number
  spans: Array<[number, number]>
}
/** The time a set of spans covers (overlapping ones once). */
function covered(spans: ReadonlyArray<[number, number]>): number {
  let total = 0
  let end = -Infinity
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }
  return total
}
function interactions(events: readonly UiEvent[]): Interaction[] {
  const out: Interaction[] = []
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    // (the few interactions before it: one it belongs to — by its id, or begun with it on the same field)
    let g: Interaction | undefined
    for (let i = out.length - 1; i >= Math.max(0, out.length - 8) && !g; i--) {
      const x = out[i]
      if ((e.id > 0 && x.id === e.id) || (x.target === e.target && e.at - x.at <= SAME_ACT_MS)) g = x
    }
    if (!g) {
      out.push({ at: e.at, target: e.target, d: e.d, delay: e.delay, proc: e.proc, names: [e.name], id: e.id, spans: [[e.at + e.delay, e.at + e.delay + e.proc]] })
      continue
    }
    if (!g.names.includes(e.name)) g.names.push(e.name)
    g.d = Math.max(g.d, e.at + e.d - g.at)
    g.spans.push([e.at + e.delay, e.at + e.delay + e.proc])
    g.proc = Math.round(covered(g.spans))
    if (e.id > 0) g.id = e.id
  }
  return out
}
const markOf = (d: number): QaMark => (d > UI_POOR_MS ? 'fail' : d > UI_GOOD_MS ? 'warn' : 'ok')

/**
 * The run's UI entry: none — nothing typed or clicked and no long frame (nothing to say). Its verdict — warn when an
 * interaction went past UI_GOOD_MS (never a failure: the scenario itself went through).
 */
export function uiReport(s: UiSamples, steps: readonly UiStep[]): QaCheck | undefined {
  const total = s.counts.keys + s.counts.inputs + s.counts.clicks
  if (!total && !s.events.length && !s.frames.length) return undefined
  const acts = interactions(s.events).sort((a, b) => b.d - a.d)
  const worst = acts[0]
  const slow = acts.filter((x) => x.d > SLOW_MS).length
  const blocked = s.frames.reduce((n, f) => n + f.block, 0)
  // who held the long frames: their scripts summed by place
  const culprits = new Map<string, { s: UiScript; d: number; n: number }>()
  for (const f of s.frames)
    for (const sc of f.scripts) {
      const k = `${sc.src}|${sc.fn}`
      const c = culprits.get(k) ?? { s: sc, d: 0, n: 0 }
      c.d += sc.d
      c.n++
      culprits.set(k, c)
    }
  const top = [...culprits.values()].sort((a, b) => b.d - a.d)
  const parts = (a: Interaction) => `задержка ${ms(a.delay)} · обработка ${ms(a.proc)} · отрисовка ${ms(Math.max(0, a.d - a.delay - a.proc))}`
  const said = [
    total ? `ввод и клики: ${total}` : '',
    worst ? `медленных (>${SLOW_MS} мс): ${slow}, худшее ${ms(worst.d)} (${parts(worst)})${worst.target ? ` — ${worst.target}` : ''}${stepAt(steps, worst.at) ? ` на шаге «${stepAt(steps, worst.at)}»` : ''}` : total ? 'каждое быстрее 16 мс' : '',
    s.frames.length ? `долгие кадры (>50 мс): ${s.frames.length}, блокировали ${ms(blocked)}${top[0] ? `, больше всех держал ${scriptName(top[0].s)} (${ms(top[0].d)})` : ''}` : '',
  ].filter(Boolean)
  const rows: string[][] = []
  const marks: QaMark[] = []
  for (const a of acts.slice(0, ROWS_SHOWN)) {
    rows.push(['Ввод и клики', stepAt(steps, a.at), a.target || '—', a.names.join(', '), ms(a.d), parts(a)])
    marks.push(markOf(a.d))
  }
  for (const c of top.slice(0, CULPRITS_SHOWN)) {
    rows.push(['Кто держал кадры', '', scriptName(c.s), c.s.inv || '—', ms(c.d), `кадров: ${c.n}${c.s.src ? ` · ${c.s.src}` : ''}`])
    marks.push(c.d > UI_POOR_MS ? 'fail' : c.d > UI_GOOD_MS ? 'warn' : 'ok')
  }
  return {
    kind: UI_METRICS,
    name: 'Отзывчивость интерфейса',
    state: worst && worst.d > UI_GOOD_MS ? 'warn' : 'ok',
    summary: said.join('; '),
    ...(rows.length ? { head: ['', 'Шаг', 'Что', 'Событие / вызов', 'Длительность', 'Из чего'], rows, marks, group: true } : {}),
  }
}
