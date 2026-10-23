import { computed, ref } from 'vue'
import { dayStart, formatHM, MINUTE } from '@shared/timeline'
import { gapAround } from '@shared/tracker/timelineRanges'
import type { Entry } from '@shared/types'
import { kindLabel } from '../lib/palette'
import type { IslandCut } from './useIslandCut'
import type { IslandDay } from './useIslandDay'
import type { IslandElements } from './islandElements'
import type { EntryEdit } from './useEntryEdit'
import type { IslandSelection } from './useIslandSelection'
import type { IslandSettings } from './useIslandSettings'
import type { TrackPointer } from './useTrackPointer'
import { OUTLOOK_READONLY } from './useToast'

/** The right-click menu: where, its title, and what it is for (a block, the multi-selection, a plan block, a range). */
export type IslandMenuState = { x: number; y: number; entryId?: string; multi?: boolean; title: string; planId?: string }

/**
 * The right-click menu on the track and the day list: change a block's kind, merge / delete the multi-selection,
 * mark a plan block done or drop it; on empty time — select the free stretch around it and cut it as a kind.
 */
export function useIslandMenu(
  els: IslandElements,
  o: { island: IslandSettings; day: IslandDay; pick: IslandSelection; pointer: TrackPointer; cut: IslandCut; edit: EntryEdit; flash: (text: string, ok: boolean) => void },
) {
  const { today, data, now } = o.day
  const { sel, entryId, multi, marker, makeSel } = o.pick
  const menu = ref<IslandMenuState>()
  /** The kind the menu marks as current. */
  const menuKind = computed(() => {
    const m = menu.value
    if (!m || m.multi) return undefined
    return m.entryId ? data.value.entries.find((e) => e.id === m.entryId)?.kind : o.cut.kind.value
  })
  /** Plan blocks already turned into real ones. */
  const planDoneIds = computed(() => new Set((data.value.plan ?? []).filter((p) => p.doneEntryId && data.value.entries.some((e) => e.id === p.doneEntryId)).map((p) => p.id)))
  /** The menu stays inside the panel. */
  const menuBounds = computed(() => {
    const r = els.panel.value?.getBoundingClientRect()
    return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : undefined
  })

  function onTrackContext(e: MouseEvent): void {
    const hit = o.pointer.entryAt(e.clientX, e.clientY)
    if (multi.value.size >= 2 && (!hit || multi.value.has(hit.id))) {
      menu.value = { x: e.clientX, y: e.clientY, multi: true, title: `Выбрано блоков: ${multi.value.size}` }
      return
    }
    if (hit) return openEntryMenu(e, hit)
    const t = o.pointer.timeAt(e.clientX, false)
    // the dashed plan under the blocks: its own menu
    const pl = o.island.ui.value.island.plan ? (data.value.plan ?? []).find((p) => t >= p.start && t < p.end) : undefined
    if (pl) {
      menu.value = { x: e.clientX, y: e.clientY, title: `План · ${pl.label}`, planId: pl.id }
      return
    }
    const m = marker.value
    if (!m || t < m.start || t > (m.end ?? now.value)) {
      const g = gapAround(data.value.entries, t, dayStart(today.value), now.value)
      if (g.end - g.start < MINUTE) return
      sel.commit(makeSel(g.start, g.end))
    }
    menu.value = { x: e.clientX, y: e.clientY, title: 'Отметить как' }
  }
  function openEntryMenu(e: MouseEvent, entry: Entry): void {
    if (entry.outlook) return o.flash(OUTLOOK_READONLY, false)
    menu.value = { x: e.clientX, y: e.clientY, entryId: entry.id, title: 'Изменить вид' }
  }

  async function planMenu(action: 'done' | 'delete'): Promise<void> {
    const id = menu.value?.planId
    menu.value = undefined
    if (!id) return
    if (action === 'done') await window.qa.planDone(today.value, id)
    else await window.qa.deletePlan(today.value, id)
  }
  async function deleteFromMenu(): Promise<void> {
    const m = menu.value
    menu.value = undefined
    if (!m) return
    const ids = m.multi ? [...multi.value] : m.entryId ? [m.entryId] : []
    if (ids.length === 1) {
      const e = data.value.entries.find((x) => x.id === ids[0])
      if (e) await o.edit.removeOne(e)
    } else for (const id of ids) if (!data.value.entries.find((x) => x.id === id)?.outlook) await window.qa.deleteEntry(today.value, id)
    if (entryId.value && ids.includes(entryId.value)) entryId.value = undefined
    multi.value = new Set()
  }
  async function mergeSelected(): Promise<void> {
    menu.value = undefined
    const merged = await window.qa.mergeEntries(today.value, [...multi.value])
    multi.value = new Set()
    if (merged) {
      entryId.value = merged.id
      o.flash(`Объединено: ${formatHM(merged.start)}–${formatHM(merged.end)}`, true)
    }
  }
  /** A kind picked: the blocks change kind; on a range — it is cut as that kind. */
  async function onMenuPick(k: string): Promise<void> {
    const m = menu.value
    menu.value = undefined
    if (!m) return
    if (m.multi || m.entryId) {
      const ids = m.multi ? [...multi.value] : [m.entryId!]
      for (const id of ids) {
        const entry = data.value.entries.find((x) => x.id === id)
        // a label that was just the old kind's name follows the new kind
        if (entry) await window.qa.saveEntry(today.value, { ...entry, kind: k, label: entry.label === kindLabel(entry.kind) ? kindLabel(k) : entry.label }, { overlap: true })
      }
      return
    }
    o.cut.kind.value = k
    await o.cut.cut()
  }

  return { menu, menuKind, planDoneIds, menuBounds, onTrackContext, openEntryMenu, planMenu, deleteFromMenu, mergeSelected, onMenuPick }
}

export type IslandMenu = ReturnType<typeof useIslandMenu>
