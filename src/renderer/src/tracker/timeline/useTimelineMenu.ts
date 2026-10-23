import { computed, ref, type Ref } from 'vue'
import { MINUTE } from '@shared/timeline'
import type { DayData, Ms, Selection } from '@shared/types'
import { gapAround } from '@shared/tracker/timelineRanges'
import type { TimelineScale } from './useTimelineScale'

/** What the menu reads from the timeline's props. */
export interface TimelineMenuProps {
  data: DayData
  bounds: [Ms, Ms]
  selection: Selection | null
}

/** The menu's events. */
export interface TimelineMenuEmit {
  (e: 'planChanged'): void
  (e: 'selection', sel: Selection | null, commit: boolean): void
  (e: 'deleteEntry', id: string): void
  (e: 'merge', ids: string[]): void
  (e: 'changeKind', change: { id: string; kind: string }): void
  (e: 'cutAs', kind: string): void
}

/** The open right-click menu: where, what for (blocks, one block, an Outlook meeting, a plan block or the marker). */
export interface TimelineMenuState {
  x: number
  y: number
  entryId?: string
  multi?: boolean
  title: string
  current?: string
  outlook?: boolean
  planId?: string
}

/**
 * The timeline's right-click menu: on several Ctrl-selected blocks — merge / kind / delete; on a block — its kind
 * (an Outlook meeting only opens); on a plan block — done / delete; on empty space — the free gap gets selected
 * and cut as the kind picked.
 */
export function useTimelineMenu(props: TimelineMenuProps, scale: TimelineScale, multi: Ref<Set<string>>, emit: TimelineMenuEmit) {
  const menu = ref<TimelineMenuState>()
  /** Plan blocks already turned into real ones (their block still exists). */
  const planDoneIds = computed(() => new Set((props.data.plan ?? []).filter((p) => p.doneEntryId && props.data.entries.some((e) => e.id === p.doneEntryId)).map((p) => p.id)))

  function openPlanMenu(e: MouseEvent, p: { id: string }): void {
    menu.value = { x: e.clientX, y: e.clientY, title: 'План', planId: p.id }
  }

  async function planMenu(action: 'done' | 'delete'): Promise<void> {
    const id = menu.value?.planId
    menu.value = undefined
    if (!id) return
    if (action === 'done') await window.qa.planDone(props.data.day, id)
    else await window.qa.deletePlan(props.data.day, id)
    emit('planChanged')
  }

  function onContext(e: MouseEvent): void {
    const at = { x: e.clientX, y: e.clientY }
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const id = under?.closest<HTMLElement>('[data-entry]')?.dataset.entry
    if (multi.value.size >= 2 && (!id || multi.value.has(id))) {
      menu.value = { ...at, multi: true, title: `Выбрано блоков: ${multi.value.size}` }
      return
    }
    if (id) {
      const entry = props.data.entries.find((x) => x.id === id)
      menu.value = entry?.outlook ? { ...at, entryId: id, title: 'Встреча из Outlook', outlook: true } : { ...at, entryId: id, title: 'Изменить вид', current: entry?.kind }
      return
    }
    const t = scale.timeAt(e.clientX, false)
    const s = props.selection
    if (!s || t < s.start || t > scale.selEnd.value) {
      const g = gapAround(props.data.entries, t, props.bounds[0], scale.limit.value)
      if (g.end - g.start < MINUTE) return
      emit('selection', scale.makeSel(g.start, g.end), true)
    }
    menu.value = { ...at, title: 'Отметить как' }
  }

  function onMenuDelete(): void {
    const m = menu.value
    menu.value = undefined
    const ids = m?.multi ? [...multi.value] : m?.entryId ? [m.entryId] : []
    for (const id of ids) emit('deleteEntry', id)
    multi.value = new Set()
  }

  function onMenuMerge(): void {
    menu.value = undefined
    emit('merge', [...multi.value])
    multi.value = new Set()
  }

  /** A kind picked: for the selected blocks, the block, or — on empty space — the marker is cut as it. */
  function onMenuPick(kind: string): void {
    const m = menu.value
    menu.value = undefined
    if (!m) return
    if (m.multi) for (const id of multi.value) emit('changeKind', { id, kind })
    else if (m.entryId) emit('changeKind', { id: m.entryId, kind })
    else emit('cutAs', kind)
  }

  return { menu, planDoneIds, openPlanMenu, planMenu, onContext, onMenuDelete, onMenuMerge, onMenuPick }
}
