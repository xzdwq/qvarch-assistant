import { ACTION_WORDS, INPUT_MERGE_MS, MAX_GROUP_MS, MAX_GROUP_NOTES, MAX_GROUP_REQS, MAX_GROUPS, QUIET_MS, type ActionKind } from './constants'
import type { ActionGroup, ActResponse, AnimEvent, GroupSummary, InspectNote, InspectReq, ScrollInfo, TaskItem } from './types'

/** A group keeps this many long frames, animations, shifts one by one (the timeline's pieces). */
const MAX_GROUP_TASKS = 100
const MAX_GROUP_ANIMS = 150
const MAX_GROUP_SHIFTS = 50

/** An act of the person (or the page's own opening / route) as the page's script tells it. */
export interface ActEvent {
  kind: ActionKind
  label: string
  target?: string
  at: number
  url?: string
}
/** A long frame of the page's main thread and the scripts that took it. */
export interface BusyEvent {
  at: number
  ms: number
  items?: TaskItem[]
}
/** A script of a long frame in a word: its file (or its invoker) and its function. */
export const taskWhere = (i: TaskItem) => `${i.src || i.name}${i.fn ? ` · ${i.fn}` : ''}`

const busyNone = () => ({ count: 0, total: 0, max: 0, scripts: [] as Array<{ src: string; ms: number }> })

/**
 * A tab's log of acts: each act opens a group that gathers what it caused — requests, console errors, the main
 * thread's busy time, the response, layout shifts — until the page is quiet (or too long). What happens with no act
 * going on is the page's own («Сама страница»). Times are wall-clock ms; `now` is given (no clock inside: testable).
 * Bounded: the groups, their requests and lines.
 */
export class ActionLog {
  private list: ActionGroup[] = []
  private byReq = new Map<string, ActionGroup>()
  private byAnim = new Map<string, ActionGroup>()
  private changed = new Set<ActionGroup>()
  private seq = 0

  groups(): ActionGroup[] {
    return this.list
  }
  /** The groups changed since the last time asked (the window is told only of them). */
  takeChanged(): ActionGroup[] {
    const out = [...this.changed].filter((g) => this.list.includes(g))
    this.changed.clear()
    return out
  }
  reset(): void {
    this.list = []
    this.byReq.clear()
    this.byAnim.clear()
    this.changed.clear()
  }

  /** The group gathering now (none — the page is quiet). */
  private open(): ActionGroup | undefined {
    const g = this.list[this.list.length - 1]
    return g && !g.closed ? g : undefined
  }
  private touch(g: ActionGroup, at: number): ActionGroup {
    if (at > g.end) g.end = at
    this.changed.add(g)
    return g
  }
  private make(kind: ActionKind, label: string, at: number, extra: Partial<ActionGroup> = {}): ActionGroup {
    const g: ActionGroup = { id: `g${++this.seq}`, kind, label, at, end: at, closed: false, reqs: [], moreReqs: 0, notes: [], busy: busyNone(), tasks: [], anims: [], shifts: [], shift: 0, ...extra }
    this.list.push(g)
    if (this.list.length > MAX_GROUPS) {
      for (const old of this.list.splice(0, this.list.length - MAX_GROUPS)) for (const r of old.reqs) this.byReq.delete(r.id)
    }
    this.changed.add(g)
    return g
  }
  private closeOpen(): void {
    const g = this.open()
    if (g) {
      g.closed = true
      this.changed.add(g)
    }
  }
  /** The group things with no act of their own go to: the one open, else the page's own. */
  private current(at: number): ActionGroup {
    return this.open() ?? this.make('background', ACTION_WORDS.background, at)
  }

  /** An act: a new group (typing on in the same field — the same one; a route right after an act — that act's). */
  act(a: ActEvent): void {
    const g = this.open() ?? this.list[this.list.length - 1]
    if (a.kind === 'input' && g?.kind === 'input' && g.target === a.target && a.at - g.end < INPUT_MERGE_MS) {
      g.closed = false
      return void this.touch(g, a.at)
    }
    if (a.kind === 'route') {
      const o = this.open()
      if (o && o.kind !== 'background' && o.kind !== 'nav') return void ((o.url = a.url), this.touch(o, a.at))
    }
    this.closeOpen()
    this.make(a.kind, a.label, a.at, { ...(a.target ? { target: a.target } : {}), ...(a.url ? { url: a.url } : {}) })
  }
  /** A request started: into the group gathering now (none — the page's own). */
  reqStart(r: InspectReq): void {
    const g = this.current(r.start)
    if (g.reqs.length >= MAX_GROUP_REQS) {
      g.moreReqs++
      return void this.touch(g, r.start)
    }
    g.reqs.push(r)
    this.byReq.set(r.id, g)
    this.touch(g, r.start)
  }
  /** A request answered / done / failed: its group (even one closed already) shows it. */
  reqUpdate(id: string, patch: Partial<InspectReq>): void {
    const g = this.byReq.get(id)
    const r = g?.reqs.find((x) => x.id === id)
    if (!g || !r) return
    Object.assign(r, patch)
    this.touch(g, patch.end ?? r.start)
  }
  note(n: InspectNote): void {
    const g = this.current(n.at)
    if (g.notes.length < MAX_GROUP_NOTES) g.notes.push(n)
    this.touch(g, n.at)
  }
  /** The main thread busy: the group it happened in (none gathering — not worth a group of its own). */
  busy(b: BusyEvent): void {
    const g = this.groupAt(b.at)
    if (!g) return
    g.busy.count++
    g.busy.total += b.ms
    g.busy.max = Math.max(g.busy.max, b.ms)
    for (const i of b.items ?? []) {
      const src = taskWhere(i)
      const had = g.busy.scripts.find((x) => x.src === src)
      if (had) had.ms += i.ms
      else g.busy.scripts.push({ src, ms: i.ms })
    }
    if (g.tasks.length < MAX_GROUP_TASKS) g.tasks.push({ at: b.at, ms: b.ms, items: b.items ?? [] })
    g.busy.scripts.sort((a, b2) => b2.ms - a.ms).splice(5)
    this.touch(g, b.at + b.ms)
  }
  /** An act's response (Event Timing): its group's — the slowest kept. */
  response(at: number, r: ActResponse): void {
    const g = this.groupAt(at)
    if (!g || g.kind === 'background' || (g.response && g.response.total >= r.total)) return
    g.response = r
    this.touch(g, at + r.total)
  }
  shift(at: number, value: number): void {
    const g = this.groupAt(at)
    if (!g) return
    g.shift += value
    if (g.shifts.length < MAX_GROUP_SHIFTS) g.shifts.push({ at, value })
    this.touch(g, at)
  }
  /** An animation started: the group of its moment shows it (its end comes later). */
  anim(a: AnimEvent): void {
    const g = this.groupAt(a.at)
    if (!g || g.anims.length >= MAX_GROUP_ANIMS) return
    g.anims.push({ ...a })
    this.byAnim.set(a.id, g)
    this.touch(g, a.at)
  }
  animEnd(id: string, at: number): void {
    const g = this.byAnim.get(id)
    const a = g?.anims.find((x) => x.id === id)
    if (!g || !a) return
    this.byAnim.delete(id)
    a.end = at
    this.changed.add(g)
  }
  /** A scroll ended: its numbers go to its group (the scroll's own, opened when it started). */
  scroll(at: number, info: ScrollInfo): void {
    const g = [...this.list].reverse().find((x) => x.kind === 'scroll' && Math.abs(x.at - at) < 1000)
    if (!g) return
    g.scroll = info
    this.touch(g, at + info.ms)
  }
  /** The group a moment belongs to: the last one started by then and not long over. */
  private groupAt(at: number): ActionGroup | undefined {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i]
      if (g.at <= at + 50) return !g.closed || at <= g.end + QUIET_MS ? g : undefined
    }
    return undefined
  }
  /** Time passes: the group gathering ends when the page has been quiet long enough, or it ran too long. */
  tick(now: number): void {
    const g = this.open()
    if (!g) return
    const going = g.reqs.some((r) => r.end === undefined && !r.failed && r.type !== 'WebSocket' && r.type !== 'EventSource')
    if ((!going && now - g.end >= QUIET_MS) || now - g.at >= MAX_GROUP_MS) {
      g.closed = true
      this.changed.add(g)
    }
  }
}

/** The time covered by intervals, the overlaps counted once. */
export function coveredTime(spans: Array<[number, number]>): number {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let from = -Infinity
  let to = -Infinity
  for (const [a, b] of s) {
    if (a > to) {
      if (to > from) total += to - from
      from = a
      to = b
    } else if (b > to) to = b
  }
  if (to > from) total += to - from
  return total
}

/** A group's numbers: how long it took, its requests (all added up and as the clock saw them), failures, errors. */
export function groupSummary(g: ActionGroup): GroupSummary {
  const spans: Array<[number, number]> = g.reqs.map((r) => [r.start, r.end ?? Math.max(r.start, g.end)])
  return {
    duration: Math.max(0, g.end - g.at),
    count: g.reqs.length + g.moreReqs,
    sum: spans.reduce((s, [a, b]) => s + Math.max(0, b - a), 0),
    wall: coveredTime(spans),
    failed: g.reqs.filter((r) => r.failed || (r.status ?? 0) >= 400).length,
    bytes: g.reqs.reduce((s, r) => s + (r.size ?? 0), 0),
    errors: g.notes.filter((n) => n.level === 'error').length,
    warnings: g.notes.filter((n) => n.level === 'warning').length,
  }
}
