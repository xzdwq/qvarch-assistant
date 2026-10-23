import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { dayStart, MINUTE } from '@shared/timeline'
import type { Entry } from '@shared/types'
import type { EntryDraft as Draft } from '../entry/entryTypes'
import { dayNum, leadOf } from '@shared/tracker/calendarDays'
import { SNAP, snapT } from '@shared/tracker/calendarGesture'
import type { CalendarData } from './useCalendarData'
import type { CalendarViewport } from './useCalendarViewport'

/** A note as the side panel edits it. */
export type PanelNote = { id: string; at: number; text: string; taskId?: string; isNew?: boolean }
/** What the side panel holds: an event (or a new one) or a note. */
export type CalendarPanel = { type: 'entry'; day: string; entry: Draft; key: string } | { type: 'note'; day: string; note: PanelNote }

/** The side panel: the open event / note (the same editors as the main window), a new event drawn while set up. */
export function useCalendarPanel(view: CalendarViewport, data: CalendarData) {
  const panel = ref<CalendarPanel>()
  function openEntry(e: Entry, day: string): void {
    panel.value = { type: 'entry', day, entry: e, key: e.id }
  }
  function openDraft(day: string, a: number, b: number, kind = 'task'): void {
    panel.value = { type: 'entry', day, entry: { start: a, end: b, kind, label: '', source: 'manual' }, key: `new${a}${kind}` }
  }
  function openNote(day: string, note: PanelNote): void {
    panel.value = { type: 'note', day, note }
  }
  /** A new event from now (30 min). */
  function addEvent(): void {
    const t = snapT(Date.now())
    openDraft(view.today.value, t, t + 30 * MINUTE)
  }
  function addNote(): void {
    openNote(view.today.value, { id: crypto.randomUUID(), at: Date.now(), text: '', isNew: true })
  }
  /** The open event of the panel, if any — reopened where it is after a reload. */
  function followEntry(id: string): void {
    const f = data.findEntry(id)
    if (f) panel.value = { type: 'entry', day: f.day, entry: f.e, key: f.e.id }
  }
  const panelNoteId = computed(() => (panel.value?.type === 'note' ? panel.value.note.id : undefined))
  const selectedId = computed(() => (panel.value?.type === 'entry' ? (panel.value.entry as Partial<Entry>).id : undefined))
  const panelDay = computed(() => (panel.value ? data.days.value.get(panel.value.day) : undefined))
  const panelEntry = computed(() => {
    const p = panel.value
    return p?.type === 'entry' && 'id' in p.entry && p.entry.id ? (panelDay.value?.entries.find((x) => x.id === (p.entry as Entry).id) ?? (p.entry as Entry)) : undefined
  })

  /** A new event being set up in the panel: drawn on the calendar (dashed) and kept in view. */
  const draft = computed(() => {
    const p = panel.value
    if (p?.type !== 'entry' || (p.entry as Partial<Entry>).id) return undefined
    return { day: p.day, n: dayNum(p.day), start: p.entry.start, end: Math.max(p.entry.end, p.entry.start + SNAP) }
  })
  function onDraftRange(r: { start: number; end: number }): void {
    const p = panel.value
    if (p?.type === 'entry' && !(p.entry as Partial<Entry>).id) panel.value = { ...p, entry: { ...p.entry, start: r.start, end: r.end } }
  }
  /** The day into view (sideways) and the time (up / down). */
  function reveal(day: string, a: number, b: number): void {
    const n = dayNum(day)
    if (n < view.start.value || n + 1 > view.start.value + view.span.value) view.start.value = n - leadOf(view.span.value)
    void nextTick(() => {
      const el = view.body.value
      if (!el) return
      const top = view.yOf(a, day)
      const bottom = view.yOf(b, day)
      if (top < el.scrollTop + 16 || bottom > el.scrollTop + el.clientHeight - 16) el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' })
    })
  }
  watch(
    () => (draft.value ? `${draft.value.day}|${draft.value.start}|${draft.value.end}` : ''),
    () => {
      const d = draft.value
      if (d) reveal(d.day, d.start, d.end)
    },
  )

  async function onSaved(e: Entry, day: string): Promise<void> {
    const p = panel.value
    // the card follows the event (to its new day when its date was changed) — unless another one was opened meanwhile
    if (p?.type === 'entry' && (!(p.entry as Partial<Entry>).id || (p.entry as Entry).id === e.id)) panel.value = { type: 'entry', day, entry: e, key: e.id }
    await data.reloadVisible()
  }
  /** A copy was made from the card: it opens (its times are what one adjusts next). */
  async function onCopied(e: Entry, day: string): Promise<void> {
    await data.reloadVisible()
    panel.value = { type: 'entry', day, entry: e, key: e.id }
  }
  async function onPanelClosed(): Promise<void> {
    panel.value = undefined
    await data.reloadVisible()
  }

  /** A saved note keeps its day (only a new one can be put on another). */
  const dateLocked = computed(() => (panel.value?.type === 'note' && !panel.value.note.isNew) || !!panelEntry.value?.outlook)
  /** The date field of the panel: a new event / note moves to that day; an existing event is moved there. */
  async function setPanelDay(day: string): Promise<void> {
    const p = panel.value
    if (!p || !day || day === p.day) return
    const shift = dayStart(day) - dayStart(p.day)
    if (p.type === 'note') {
      if (p.note.isNew) panel.value = { type: 'note', day, note: { ...p.note, at: p.note.at + shift } }
      return
    }
    const e = panelEntry.value
    if (e) {
      await window.qa.moveEntry(p.day, day, e.id, e.start + shift, e.end + shift)
      await data.reloadVisible()
      followEntry(e.id)
    } else panel.value = { ...p, day, entry: { ...p.entry, start: p.entry.start + shift, end: p.entry.end + shift } }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && panel.value && !(e.target as HTMLElement).closest('input, textarea')) panel.value = undefined
  }
  window.addEventListener('keydown', onKey)
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

  const isToday = (d: string) => d === view.today.value

  return { panel, openEntry, openDraft, openNote, addEvent, addNote, followEntry, panelNoteId, selectedId, panelDay, panelEntry, draft, onDraftRange, onSaved, onCopied, onPanelClosed, dateLocked, setPanelDay, isToday }
}

export type CalendarPanelState = ReturnType<typeof useCalendarPanel>
