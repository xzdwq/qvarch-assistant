import { ref } from 'vue'
import { dayEnd, MINUTE } from '@shared/timeline'
import type { Entry } from '@shared/types'
import { kindLabel } from '../../lib/palette'
import { askSeries } from '../../lib/seriesAsk'
import { dayKey } from '@shared/tracker/calendarDays'
import type { CalendarData } from './useCalendarData'
import type { CalendarGestures } from './useCalendarGestures'
import type { CalendarPanelState } from './useCalendarPanel'

/** The right-click menu, as on the timeline: on an event — its kind, open, delete; on an empty spot — a new event or a note. */
export function useCalendarMenu(data: CalendarData, gestures: CalendarGestures, panelState: CalendarPanelState) {
  const { panel, openDraft, openEntry, openNote } = panelState
  const cmenu = ref<{ x: number; y: number; day: string; t: number; entry?: Entry }>()
  function onContext(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    const n = gestures.dayAt(e.clientX)
    const t = gestures.timeAt(e.clientY, n)
    const f = el ? data.findEntry(el.dataset.entry!) : undefined
    cmenu.value = { x: e.clientX, y: e.clientY, day: f?.day ?? dayKey(n), t, entry: f?.e }
  }
  /** Takes the menu's target and closes it. */
  function takeMenu() {
    const m = cmenu.value
    cmenu.value = undefined
    return m
  }
  async function onMenuKind(kind: string): Promise<void> {
    const m = takeMenu()
    if (!m) return
    // an empty spot: a new block of that kind there (30 min); a block: its kind changes
    if (!m.entry) return openDraft(m.day, m.t, Math.min(dayEnd(m.day), m.t + 30 * MINUTE), kind)
    const e = m.entry
    if (e.outlook) return
    const label = e.label === kindLabel(e.kind) ? kindLabel(kind) : e.label
    await window.qa.saveEntry(m.day, { ...e, kind, label }, { overlap: true })
    await data.reloadVisible()
  }
  function menuOpen(): void {
    const m = takeMenu()
    if (m?.entry) openEntry(m.entry, m.day)
  }
  function menuNote(): void {
    const m = takeMenu()
    if (m) openNote(m.day, { id: crypto.randomUUID(), at: m.t, text: '', isNew: true })
  }
  /** Deletes the event (a series asks: this one or all). */
  async function menuDelete(): Promise<void> {
    const m = takeMenu()
    const e = m?.entry
    if (!m || !e || e.outlook) return
    if (e.series) {
      const scope = await askSeries('delete')
      if (!scope) return
      if (scope === 'all') await window.qa.seriesDelete(m.day, e.id)
      else await window.qa.deleteEntry(m.day, e.id)
    } else await window.qa.deleteEntry(m.day, e.id)
    if (panel.value?.type === 'entry' && (panel.value.entry as Partial<Entry>).id === e.id) panel.value = undefined
    await data.reloadVisible()
  }

  return { cmenu, onContext, onMenuKind, menuOpen, menuNote, menuDelete }
}
