import { computed, ref, watch } from 'vue'
import { MINUTE, quickRange } from '@shared/timeline'
import type { Entry, Ms, Note, Selection } from '@shared/types'
import { useSelection } from '../lib/selection'
import type { IslandDay } from './useIslandDay'

/** A note open in the expanded island (a new one, or a pin clicked on the timeline). */
export type PanelNote = { id: string; at: Ms; text: string; taskId?: string; isNew?: boolean }

/** ±minutes the dial starts with: the last 10. */
const DIAL_DEFAULT = -10

/**
 * What is picked in the island: the marker (a range shared with the main window) or the implicit period,
 * the highlighted block, the time divider, the Ctrl+click multi-selection, the open note.
 * `clickEntry` asks the edit / cut parts (passed lazily) whether to ignore the click or to continue a topic.
 */
export function useIslandSelection(day: IslandDay, hooks: { isEditing: (id: string) => boolean; continueFrom: (e: Entry) => void }) {
  const { today, data, now, cursor, schedule } = day
  const sel = useSelection()
  /** The highlighted block. */
  const entryId = ref<string>()
  const selectedEntry = computed(() => data.value.entries.find((e) => e.id === entryId.value))
  /** The time divider placed by a click. */
  const pinT = ref<Ms>()
  /** Ctrl+click multi-selection. */
  const multi = ref<Set<string>>(new Set())

  const marker = computed<Selection | null>(() => (sel.selection.value?.day === today.value ? sel.selection.value : null))
  /** Without a picked range a quick add goes to the latest free work time, else an hour forward (see quickRange). */
  const implicit = computed<Selection | null>(() => {
    const r = quickRange(data.value.entries, schedule.value.work, schedule.value.lunch, now.value, cursor.value)
    return { day: today.value, start: r.start, end: r.end >= now.value - MINUTE ? undefined : r.end }
  })
  const active = computed(() => marker.value ?? implicit.value)
  const activeEnd = computed(() => (active.value ? (active.value.end ?? now.value) : 0))

  /** Only an end right at "now" follows the time; a future end is a fixed, planned end. */
  function makeSel(start: Ms, end: Ms): Selection {
    return { day: today.value, start, end: Math.abs(now.value - end) < MINUTE ? undefined : end }
  }
  function resetSelection(): void {
    entryId.value = undefined
    pinT.value = undefined
    multi.value = new Set()
    sel.clear()
  }
  /** The period from the time range (an end at "now" keeps following it). */
  function setPeriod(r: { start: Ms; end: Ms }): void {
    if (active.value) sel.commit(makeSel(r.start, Math.max(r.end, r.start + MINUTE)))
  }
  /** Nothing uncut: an explicit period from now (e.g. to plan a block ahead) — adjust its times as needed. */
  function planPeriod(): void {
    sel.commit({ day: today.value, start: Math.round(now.value / MINUTE) * MINUTE, end: Math.round(now.value / MINUTE) * MINUTE + 30 * MINUTE })
  }

  /** ±minutes (the last 10 by default): − the last N minutes up to now, + the next N from now; it moves the marker live. */
  const dial = ref(DIAL_DEFAULT)
  function onDial(v: number): void {
    dial.value = v
    if (v < 0) lastMinutes(-v)
    else if (v > 0) nextMinutes(v)
  }
  function nextMinutes(n: number): void {
    entryId.value = undefined
    pinT.value = undefined
    const t = Math.floor(now.value / MINUTE) * MINUTE
    sel.commit({ day: today.value, start: t, end: t + n * MINUTE })
  }
  function lastMinutes(n: number): void {
    entryId.value = undefined
    pinT.value = undefined
    sel.commit({ day: today.value, start: now.value - n * MINUTE })
  }
  watch(marker, (m) => {
    if (!m) dial.value = DIAL_DEFAULT
  })

  /** The note open in the expanded island. */
  const panelNote = ref<PanelNote>()
  function openPanelNote(n?: Note): void {
    // a second click (on the same pin, or on the header button) closes it — the editor saves on its way out
    if (panelNote.value && (!n || panelNote.value.id === n.id)) {
      panelNote.value = undefined
      return
    }
    // a new note starts at "now"; clicking the timeline while it is open moves it to that moment
    panelNote.value = n ? { id: n.id, at: n.at, text: n.text, taskId: n.taskId } : { id: crypto.randomUUID(), at: Date.now(), text: '', isNew: true }
  }
  // an open note takes the moment clicked on the timeline
  watch(pinT, (t) => {
    // only a note being written right now — an existing one (or a recording) keeps its moment
    if (t !== undefined && panelNote.value?.isNew) panelNote.value = { ...panelNote.value, at: t }
  })

  function toggleMulti(id: string): void {
    const s = new Set(multi.value)
    // the block selected by a plain click joins the multi-selection
    if (entryId.value && !s.size) s.add(entryId.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    multi.value = s
    entryId.value = undefined
  }
  /** With a selection: "continue that topic" (copy kind/text); otherwise highlight the block + divider. */
  function clickEntry(entry: Entry, t?: Ms): void {
    multi.value = new Set()
    if (hooks.isEditing(entry.id)) return
    if (marker.value) return hooks.continueFrom(entry)
    entryId.value = entry.id
    pinT.value = t
  }

  return {
    sel,
    entryId,
    selectedEntry,
    pinT,
    multi,
    marker,
    implicit,
    active,
    activeEnd,
    makeSel,
    resetSelection,
    setPeriod,
    planPeriod,
    dial,
    onDial,
    panelNote,
    openPanelNote,
    toggleMulti,
    clickEntry,
  }
}

export type IslandSelection = ReturnType<typeof useIslandSelection>
