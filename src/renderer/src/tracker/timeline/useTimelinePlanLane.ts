import { computed, ref, useTemplateRef } from 'vue'
import { PLAN_STEP, planRows, snapPlan } from '@shared/plan'
import type { DayData, Ms, PlanBlock } from '@shared/types'

/** What the plan lane reads from the timeline's props. */
export interface TimelinePlanProps {
  data: DayData
  bounds: [Ms, Ms]
  planMode?: boolean
  selectedPlanId?: string
}

/** The plan lane's events. */
export interface TimelinePlanEmit {
  (e: 'planChange', change: { id: string; start: Ms; end: Ms }): void
  (e: 'planSelect', id: string | undefined): void
}

/** Height of one plan row, px. */
export const PLAN_ROW = 24
/** An edge grab zone of a plan block, px. */
const EDGE_PX = 7

/**
 * The day plan lane: planned blocks live apart from what happened (their own lane, dashed, never in the stats).
 * A block drags (or its edge resizes) in plan steps; a click selects it; drops from the palette land by `planTimeAt`.
 */
export function useTimelinePlanLane(props: TimelinePlanProps, rawTimeAt: (clientX: number) => Ms, emit: TimelinePlanEmit) {
  const plan = computed(() => props.data.plan ?? [])
  const showPlan = computed(() => !!props.planMode || plan.value.length > 0)
  /** A plan block being moved / resized (preview until release). */
  const planDrag = ref<{ id: string; mode: 'move' | 'l' | 'r'; x0: number; t0: Ms; start: Ms; end: Ms; moved: boolean }>()
  const planShown = computed(() => {
    const d = planDrag.value
    return d ? plan.value.map((p) => (p.id === d.id ? { ...p, start: d.start, end: d.end } : p)) : plan.value
  })
  const planRowOf = computed(() => planRows(planShown.value))
  const planH = computed(() => Math.max(1, ...[...planRowOf.value.values()].map((r) => r + 1)) * PLAN_ROW + 8)
  /** The plan lane element (template ref "planLane"). */
  const planLane = useTemplateRef<HTMLElement>('planLane')

  function onPlanDown(e: PointerEvent, p: PlanBlock): void {
    if (e.button !== 0) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mode = e.clientX - r.left < EDGE_PX ? 'l' : r.right - e.clientX < EDGE_PX ? 'r' : 'move'
    planDrag.value = { id: p.id, mode, x0: e.clientX, t0: rawTimeAt(e.clientX), start: p.start, end: p.end, moved: false }
    window.addEventListener('pointermove', onPlanMove)
    window.addEventListener('pointerup', onPlanUp, { once: true })
  }

  function onPlanMove(e: PointerEvent): void {
    const d = planDrag.value
    const p = d && plan.value.find((x) => x.id === d.id)
    if (!d || !p) return
    d.moved ||= Math.abs(e.clientX - d.x0) > 3
    if (!d.moved) return
    const delta = snapPlan(rawTimeAt(e.clientX) - d.t0)
    const [lo, hi] = props.bounds
    switch (d.mode) {
      case 'move': {
        const start = Math.max(lo, Math.min(hi - (p.end - p.start), p.start + delta))
        d.start = start
        d.end = start + (p.end - p.start)
        return
      }
      case 'l':
        d.start = Math.max(lo, Math.min(p.end - PLAN_STEP, snapPlan(p.start + delta)))
        return
      case 'r':
        d.end = Math.min(hi, Math.max(p.start + PLAN_STEP, snapPlan(p.end + delta)))
        return
    }
  }

  function onPlanUp(): void {
    window.removeEventListener('pointermove', onPlanMove)
    const d = planDrag.value
    planDrag.value = undefined
    if (!d) return
    if (d.moved) emit('planChange', { id: d.id, start: d.start, end: d.end })
    else emit('planSelect', d.id === props.selectedPlanId ? undefined : d.id)
  }

  /** The plan time under a screen point, if it is over the plan lane (a drop from the plan palette). */
  function planTimeAt(x: number, y: number): Ms | undefined {
    const r = planLane.value?.getBoundingClientRect()
    if (!r || x < r.left || x > r.right || y < r.top - 10 || y > r.bottom + 10) return undefined
    return Math.max(props.bounds[0], Math.min(props.bounds[1] - PLAN_STEP, snapPlan(rawTimeAt(x))))
  }

  return { plan, showPlan, planDrag, planShown, planRowOf, planH, onPlanDown, planTimeAt }
}
