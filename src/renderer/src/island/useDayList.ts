import { computed, ref, watch } from 'vue'
import { noteEntry, visibleNotes } from '@shared/notes'
import { unionMs } from '@shared/timeline'
import { dayListRows } from '@shared/tracker/islandCut'
import type { IslandDay } from './useIslandDay'

const LIST_KEY = 'qa.island.list'

/** Whether the list was left open (default: open). */
function readListOpen(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? '{}')
    return v.open !== false
  } catch {
    return true
  }
}

/** The island's day list: blocks with their notes; it folds and the state survives restarts. */
export function useDayList({ data }: IslandDay) {
  const listOpen = ref(readListOpen())
  watch(listOpen, () => {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify({ open: listOpen.value }))
    } catch {
      // storage unavailable — just don't remember
    }
  })
  function toggleList(): void {
    listOpen.value = !listOpen.value
  }
  const blockCount = computed(() => data.value.entries.length)
  const labelledMs = computed(() => unionMs(data.value.entries))
  const listRows = computed(() => dayListRows(data.value.entries, data.value.notes))
  /** The block each note belongs to (by time). */
  const noteOwner = computed(() => new Map(visibleNotes(data.value.notes).map((n) => [n.id, noteEntry(n, data.value.entries)])))
  const notesOf = (id: string) => visibleNotes(data.value.notes).filter((n) => noteOwner.value.get(n.id)?.id === id)
  return { listOpen, toggleList, blockCount, labelledMs, listRows, notesOf }
}
