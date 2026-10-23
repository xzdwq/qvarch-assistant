import { computed, nextTick, ref, watch } from 'vue'
import { noteEntry } from '@shared/notes'
import type { Ms } from '@shared/types'
import { kindLabel } from '../lib/palette'
import type { IslandDay } from './useIslandDay'
import type { IslandElements } from './islandElements'
import type { IslandSettings } from './useIslandSettings'
import { useQuickRecording } from './useQuickRecording'

/** The orb panel's tabs: Текст / Аудио / Событие / Звонок. */
export type QuickTab = 'text' | 'audio' | 'event' | 'call'
const QUICK_TABS: readonly QuickTab[] = ['text', 'audio', 'event', 'call']
const TAB_KEY = 'qa.orbTab'

function readTab(): QuickTab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return QUICK_TABS.find((t) => t === v) ?? 'text'
  } catch {
    return 'text'
  }
}

/**
 * The quick note (click the orb): a textarea opens next to the pill and the text is saved while typing. The next
 * click closes it — the note becomes a pin on the timeline and belongs to the block running at its moment.
 * The same area records a voice note or the call, and adds an event (see useQuickEvent).
 */
export function useQuickNote(els: IslandElements, day: IslandDay, island: IslandSettings, hooks: { cancelExpand: () => void }) {
  const { today, data, live } = day
  const noteOpen = ref(false)
  const note = ref<{ id: string; at: Ms; text: string }>()
  const qtab = ref<QuickTab>(readTab())
  watch(qtab, (v) => {
    try {
      localStorage.setItem(TAB_KEY, v)
    } catch {
      // not remembered
    }
  })
  /** The last outcome shown in the area's header. */
  const qMsg = ref('')
  /** The open note already got its audio (it must not be deleted as "empty" on close). */
  const noteHasAudio = ref(false)
  const rec = useQuickRecording({ today, settings: island.settings, note, qMsg, noteHasAudio })
  let noteTimer: ReturnType<typeof setTimeout> | undefined

  /** The block the open note will belong to (or "during a call" when the call block is not cut yet). */
  const noteTarget = computed(() => {
    const n = note.value
    if (!n) return undefined
    const e = noteEntry(n, data.value.entries)
    if (e) return `${kindLabel(e.kind)}${e.label && e.label !== kindLabel(e.kind) ? ` · ${e.label}` : ''}`
    return live.value.inCall ? 'созвон' : undefined
  })

  async function toggleNote(): Promise<void> {
    if (noteOpen.value) return closeNote()
    hooks.cancelExpand()
    note.value = { id: crypto.randomUUID(), at: Date.now(), text: '' }
    noteHasAudio.value = false
    qMsg.value = ''
    // during a call the panel opens on the call tab; a running recording — on its tab
    if (rec.recording.value) qtab.value = rec.recording.value.kind === 'call' ? 'call' : 'audio'
    noteOpen.value = true
    window.qa.islandFocus()
    await nextTick()
    // the shell is still growing: a plain focus() would scroll the (overflow: hidden) shell to the textarea
    // and the whole pill would slide up and back — focus without scrolling, and keep the shell unscrolled
    els.noteArea.value?.focus({ preventScroll: true })
    if (els.shell.value) els.shell.value.scrollTop = 0
  }
  function onNoteInput(): void {
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => void saveNote(), 400)
  }
  async function saveNote(): Promise<void> {
    const n = note.value
    if (n?.text.trim()) await window.qa.saveNote(today.value, { ...n })
  }
  async function closeNote(): Promise<void> {
    clearTimeout(noteTimer)
    const n = note.value
    noteOpen.value = false
    note.value = undefined
    qMsg.value = ''
    window.qa.islandBlur()
    if (!n) return
    // a recording is saved already
    if (noteHasAudio.value) return
    if (n.text.trim()) await window.qa.saveNote(today.value, { ...n })
    else await window.qa.deleteNote(today.value, n.id) // typed and erased — nothing to keep
  }
  /** Текст: the note becomes an own task (the note stays, linked). */
  async function quickToTask(): Promise<void> {
    const n = note.value
    if (!n?.text.trim()) return
    clearTimeout(noteTimer)
    await window.qa.saveNote(today.value, { ...n })
    await window.qa.noteToTask(today.value, n.id)
    // the note is now a "Задача" block on the timeline — the panel closes (nothing left to save or delete)
    noteOpen.value = false
    note.value = undefined
    window.qa.islandBlur()
  }
  function onNoteKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') void closeNote()
  }

  return { noteOpen, note, qtab, qMsg, noteTarget, toggleNote, onNoteInput, quickToTask, onNoteKey, ...rec }
}

export type QuickNote = ReturnType<typeof useQuickNote>
