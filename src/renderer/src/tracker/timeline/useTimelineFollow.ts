import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { MINUTE } from '@shared/timeline'
import type { Ms, UiPrefs } from '@shared/types'
import { rememberedViews } from '../../lib/viewport'
import type { TimelineScale } from './useTimelineScale'

/** What following the time reads from the timeline's props. */
export interface TimelineFollowProps {
  now?: Ms
  follow?: UiPrefs['timeline']
  viewKey?: string
}

/**
 * Following the time: every stepSec the window moves so "now" stands leftPx from the left; a manual move
 * pauses it, idleSec after the last one it comes back (and jumps to now at once). The window is remembered
 * under `viewKey` (a section switched away and back shows it as it was).
 */
export function useTimelineFollow(props: TimelineFollowProps, scale: TimelineScale, onToggle: (on: boolean) => void) {
  const { vp, from, to, canvas } = scale
  let applying = false
  let lastManual = 0
  let lastApply = 0
  let stale = true

  /** Puts now at its offset; `keepSpan` — the scale to keep when zoom is not fixed. */
  function applyFollow(instant = false, keepSpan?: number): void {
    const f = props.follow
    const el = canvas.value
    if (!f || !el || props.now === undefined) return
    const w = el.clientWidth || 1
    const span = f.zoom === 'fixed' ? f.spanMin * MINUTE : (keepSpan ?? to.value - from.value)
    const a = Date.now() - (Math.min(f.leftPx, w - 20) / w) * span
    applying = true
    if (instant) vp.setRange([a, a + span])
    else vp.glideTo([a, a + span])
    void nextTick(() => (applying = false))
    lastApply = Date.now()
    stale = false
  }

  /** The user moved / zoomed the timeline: following pauses. */
  function markManual(): void {
    lastManual = Date.now()
    stale = true
  }

  /** The switch: on — to "now" at once (not after the first step). */
  function toggleFollow(): void {
    const on = !props.follow?.follow
    if (on) {
      lastManual = 0
      applyFollow()
    }
    onToggle(on)
  }

  /** One step of the clock: re-applies when due and the user has been idle long enough. */
  function followTick(): void {
    const f = props.follow
    if (!f?.follow || props.now === undefined) return
    if (Date.now() - lastManual < f.idleSec * 1000) return
    if (stale || Date.now() - lastApply >= f.stepSec * 1000) applyFollow()
  }

  watch(
    () => props.follow?.follow,
    (on) => {
      if (on) {
        lastManual = 0
        stale = true
        followTick()
      }
    },
  )

  // the width settles after mounting (a dashboard widget): "now" is put back at its offset
  let followRo: ResizeObserver | undefined
  onMounted(() => {
    let lastW = 0
    followRo = new ResizeObserver(() => {
      const w = canvas.value?.clientWidth ?? 0
      if (Math.abs(w - lastW) < 2) return
      lastW = w
      if (props.follow?.follow && Date.now() - lastManual >= (props.follow.idleSec ?? 10) * 1000) applyFollow(true, to.value - from.value)
    })
    if (canvas.value) followRo.observe(canvas.value)
  })
  onBeforeUnmount(() => followRo?.disconnect())
  onMounted(() => {
    const r = props.viewKey ? rememberedViews.get(props.viewKey) : undefined
    // following: straight to "now" at the remembered scale — no whole-day flash on coming back
    if (props.follow?.follow) applyFollow(true, r ? r[1] - r[0] : undefined)
    else if (r) vp.setRange(r)
  })
  watch([from, to], ([a, b]) => {
    if (props.viewKey && vp.zoomed.value && !applying) rememberedViews.set(props.viewKey, [a, b])
  })
  const followTimer = setInterval(followTick, 1000)
  onBeforeUnmount(() => clearInterval(followTimer))

  return { markManual, toggleFollow }
}
