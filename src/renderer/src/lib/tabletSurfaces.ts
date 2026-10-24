import { shallowRef } from 'vue'
import { EdgeHop, type HopPending, type HopRect } from '@shared/tabletHop'

/**
 * The drawing surfaces on screen as the tablet's «Полотно Qvarch»: the pen is mapped onto one of them — its visible
 * part (clipped by the scrolling panes around it and the window), followed as the page scrolls or resizes. Which
 * one: the one pressed / entered last; one gone or scrolled away — the most visible other; none — the whole window.
 * Several on screen (boards in a note): held at an edge, hovering, the pen goes over to the surface beyond (EdgeHop).
 */

type Box = { x: number; y: number; w: number; h: number }
/** What the pen is doing now (the tablet run by Qvarch, mapped onto the surfaces), if it is. */
export interface PenNow {
  hovering: boolean
  touching: boolean
}
interface Deps {
  /** The pen now (undefined — the tablet is not on the surfaces / not in range). */
  pen: () => PenNow | undefined
  /** The area the pen is mapped onto (device px from the window's corner), or none — the whole window. */
  send: (rect: Box | null) => void
  /** How long the pen is held at an edge before it goes over, ms (the tablet's setting). */
  hopMs: () => number
}

/** How far back the pointer's way is looked at for where it is going, ms. */
const HEADING_MS = 150
const MIN_PX = 4

/** An element's part on screen: clipped by every ancestor that cuts its content and by the window; none — out of sight. */
export function visibleBox(el: HTMLElement): Box | undefined {
  const r = el.getBoundingClientRect()
  let [x0, y0, x1, y1] = [r.left, r.top, r.right, r.bottom]
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (!/(auto|scroll|hidden|clip)/.test(`${s.overflowX} ${s.overflowY}`)) continue
    const q = p.getBoundingClientRect()
    ;[x0, y0, x1, y1] = [Math.max(x0, q.left), Math.max(y0, q.top), Math.min(x1, q.right), Math.min(y1, q.bottom)]
  }
  ;[x0, y0, x1, y1] = [Math.max(x0, 0), Math.max(y0, 0), Math.min(x1, innerWidth), Math.min(y1, innerHeight)]
  return x1 - x0 >= MIN_PX && y1 - y0 >= MIN_PX ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined
}

export class TabletSurfaces {
  private readonly els = new Map<number, HTMLElement>()
  private nextId = 0
  private active?: number
  private sent = ''
  private frame = 0
  private readonly ro = new ResizeObserver(() => this.schedule())
  private readonly hop: EdgeHop
  /** The pointer: where it is and its way lately; a button held. */
  private at = { x: 0, y: 0 }
  private trail: Array<{ x: number; y: number; t: number }> = []
  private buttons = 0
  /** The hop being waited for (a surface shows it). */
  readonly pending = shallowRef<HopPending>()
  /** Bumped when the active surface changes (the surfaces' own computeds follow it). */
  readonly activeTick = shallowRef(0)

  constructor(private deps: Deps) {
    this.hop = new EdgeHop(deps.hopMs)
  }

  /** A surface appeared: active when none is (or the active one is out of sight). */
  add(el: HTMLElement): number {
    const id = ++this.nextId
    if (!this.els.size) this.listen(true)
    this.els.set(id, el)
    this.ro.observe(el)
    if (this.active === undefined || !this.boxOf(this.active)) this.activate(id)
    return id
  }
  remove(id: number): void {
    const el = this.els.get(id)
    if (el) this.ro.unobserve(el)
    this.els.delete(id)
    if (!this.els.size) this.listen(false)
    if (this.active === id) this.activate(this.mostVisible())
  }
  /** This surface is the pen's (pressed / entered / gone over to — the pen lies on it as on the tablet). */
  activate(id: number | undefined): void {
    if (this.active !== id) {
      this.active = id
      this.activeTick.value++
    }
    this.pending.value = undefined
    this.hop.reset()
    this.schedule()
  }
  isActive = (id: number) => this.active === id

  private boxOf(id: number): Box | undefined {
    const el = this.els.get(id)
    return el && visibleBox(el)
  }
  /** The surface with the most of it on screen. */
  private mostVisible(): number | undefined {
    let best: { id: number; area: number } | undefined
    for (const id of this.els.keys()) {
      const b = this.boxOf(id)
      if (b && (!best || b.w * b.h > best.area)) best = { id, area: b.w * b.h }
    }
    return best?.id
  }

  /** The area reported a frame later (once for a burst of scrolls / resizes). */
  schedule = (): void => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.report()
    })
  }
  private report(): void {
    let box = this.active !== undefined ? this.boxOf(this.active) : undefined
    // the active surface scrolled away: the most visible other takes the pen
    if (!box && this.active !== undefined) {
      const other = this.mostVisible()
      if (other !== undefined && other !== this.active) return this.activate(other)
    }
    const k = devicePixelRatio
    const rect = box ? { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k } : null
    const key = JSON.stringify(rect)
    if (key === this.sent) return
    this.sent = key
    this.deps.send(rect)
  }

  // ---------- the pen over the surfaces: its way, the hop ----------
  private onPointer = (e: PointerEvent): void => {
    const t = performance.now()
    this.at = { x: e.clientX, y: e.clientY }
    this.buttons = e.buttons
    this.trail = [...this.trail.filter((p) => t - p.t <= HEADING_MS), { ...this.at, t }]
    this.feed()
  }
  /** Where the pointer has been going lately, px / s. */
  private heading(): { x: number; y: number } {
    const t = performance.now()
    const way = this.trail.filter((p) => t - p.t <= HEADING_MS)
    const a = way[0]
    const b = way.at(-1)
    const dt = a && b ? (b.t - a.t) / 1000 : 0
    return a && b && dt > 0 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 }
  }
  /** The pen's state now fed to the hop (a pointer move, a pen sample — clamped at an edge, only samples come). */
  feed = (): void => {
    const pen = this.deps.pen()
    const id = this.active
    const box = id !== undefined ? this.boxOf(id) : undefined
    if (!pen || id === undefined || !box || this.els.size < 2) {
      if (this.pending.value) this.pending.value = undefined
      this.hop.reset()
      return
    }
    const others: HopRect[] = []
    for (const o of this.els.keys()) {
      const b = o === id ? undefined : this.boxOf(o)
      if (b) others.push({ id: o, ...b })
    }
    const r = this.hop.feed({ now: performance.now(), at: this.at, active: { id, ...box }, others, hovering: pen.hovering, drawing: pen.touching || this.buttons !== 0, heading: this.heading() })
    if (r.hop !== undefined) return this.activate(r.hop)
    const p = r.pending
    const cur = this.pending.value
    if (p?.target !== cur?.target || p?.side !== cur?.side || Math.abs((p?.progress ?? 0) - (cur?.progress ?? 0)) > 0.04) this.pending.value = p
  }

  private listen(on: boolean): void {
    const f = on ? addEventListener : removeEventListener
    f('scroll', this.schedule, true)
    f('resize', this.schedule)
    f('pointermove', this.onPointer as EventListener, true)
    f('pointerdown', this.onPointer as EventListener, true)
    f('pointerup', this.onPointer as EventListener, true)
  }
}
