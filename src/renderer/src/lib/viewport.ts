import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { HOUR, MINUTE } from '@shared/timeline'
import type { Ms } from '@shared/types'

/**
 * Visible time window of a timeline with smooth wheel zoom / pan.
 * Until the user zooms, the window follows `initial()` (e.g. "work day up to now").
 */
export function useViewport(opts: { bounds: () => [Ms, Ms]; initial: () => [Ms, Ms]; minSpan?: number }) {
  const minSpan = opts.minSpan ?? 10 * MINUTE
  const from = ref(0)
  const to = ref(0)
  const zoomed = ref(false)
  let target: [Ms, Ms] | undefined
  let raf = 0

  function clamp([a, b]: [Ms, Ms]): [Ms, Ms] {
    const [lo, hi] = opts.bounds()
    const span = Math.min(Math.max(b - a, minSpan), hi - lo)
    const start = Math.min(Math.max(a, lo), hi - span)
    return [start, start + span]
  }

  function step(): void {
    raf = 0
    if (!target) return
    const k = 0.28
    from.value += (target[0] - from.value) * k
    to.value += (target[1] - to.value) * k
    const done = Math.abs(target[0] - from.value) < 1000 && Math.abs(target[1] - to.value) < 1000
    if (done) {
      ;[from.value, to.value] = target
      target = undefined
    } else raf = requestAnimationFrame(step)
  }

  function animateTo(range: [Ms, Ms]): void {
    target = clamp(range)
    if (!raf) raf = requestAnimationFrame(step)
  }

  watch(
    () => opts.initial(),
    (r) => {
      if (zoomed.value) return
      const c = clamp(r)
      if (target) animateTo(c)
      else [from.value, to.value] = c
    },
    { immediate: true },
  )

  function zoomAt(t: Ms, factor: number): void {
    const [a, b] = target ?? [from.value, to.value]
    zoomed.value = true
    animateTo([t - (t - a) * factor, t + (b - t) * factor])
  }

  function panBy(dt: number): void {
    const [a, b] = target ?? [from.value, to.value]
    zoomed.value = true
    animateTo([a + dt, b + dt])
  }

  /** Wheel: zoom around the cursor; Shift+wheel or horizontal wheel/touchpad: pan. */
  function onWheel(e: WheelEvent, el: HTMLElement): void {
    const r = el.getBoundingClientRect()
    const span = to.value - from.value
    const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)
    if (horizontal) panBy(((e.deltaX || e.deltaY) / r.width) * span)
    else zoomAt(from.value + ((e.clientX - r.left) / r.width) * span, Math.exp(e.deltaY * 0.0015))
  }

  /** Immediate jump (e.g. drag-panning follows the pointer exactly). */
  function setRange(range: [Ms, Ms]): void {
    zoomed.value = true
    target = undefined
    ;[from.value, to.value] = clamp(range)
  }

  function reset(): void {
    zoomed.value = false
    animateTo(opts.initial())
  }

  /** A smooth move to a window (following the time). */
  function glideTo(range: [Ms, Ms]): void {
    zoomed.value = true
    animateTo(range)
  }

  onBeforeUnmount(() => raf && cancelAnimationFrame(raf))
  return { from, to, zoomed, onWheel, zoomAt, panBy, setRange, reset, glideTo }
}

/** Where each timeline was left (by its key — a day): coming back to a section shows the same window. */
export const rememberedViews = new Map<string, [Ms, Ms]>()

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360].map((m) => m * MINUTE)

/** Tick marks for a window: the smallest "nice" step that keeps at most `maxTicks` labels. */
export function ticks(from: Ms, to: Ms, maxTicks: number): { step: number; list: Ms[] } {
  const span = to - from
  const step = STEPS.find((s) => span / s <= maxTicks) ?? 6 * HOUR
  const list: Ms[] = []
  // align to local time (timezone offset matters for steps < 1 day)
  const off = new Date(from).getTimezoneOffset() * MINUTE
  for (let t = Math.ceil((from - off) / step) * step + off; t <= to; t += step) list.push(t)
  return { step, list }
}

/** Snaps to the nearest candidate within `px` pixels, otherwise to the minute. */
export function snap(t: Ms, candidates: Ms[], msPerPx: number, px = 6): Ms {
  let best = Math.round(t / MINUTE) * MINUTE
  let bestD = px * msPerPx
  for (const c of candidates) {
    const d = Math.abs(c - t)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

export type Box = { left: string; width: string }

/** Absolute box for [a, b] in a [from, to] track, with a small gap so neighbours read as separate segments. */
export function segBox(a: Ms, b: Ms, from: Ms, to: Ms, gapPx = 1): Box {
  const span = to - from || 1
  const l = ((Math.max(a, from) - from) / span) * 100
  const r = ((Math.min(b, to) - from) / span) * 100
  const w = Math.max(r - l, 0)
  return { left: `calc(${l}% + ${gapPx}px)`, width: `max(calc(${w}% - ${gapPx * 2}px), 2px)` }
}

export function pctOf(t: Ms, from: Ms, to: Ms): number {
  return ((t - from) / (to - from || 1)) * 100
}

export function visible<T extends { start: Ms; end: Ms }>(list: T[], from: Ms, to: Ms): T[] {
  return list.filter((x) => x.end > from && x.start < to)
}

export type ViewportRef = Ref<number>
