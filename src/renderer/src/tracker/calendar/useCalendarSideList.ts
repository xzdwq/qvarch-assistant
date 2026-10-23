import { computed, nextTick, ref, watch } from 'vue'
import { visibleNotes } from '@shared/notes'
import { formatHM } from '@shared/timeline'
import type { Entry } from '@shared/types'
import { openUrl } from '../../lib/links'
import { useJira } from '../../lib/jira'
import { entryIcon, kindColor } from '../../lib/palette'
import { byDay, neighboursOf, type DayItem } from '@shared/tracker/calendarItems'
import { noteIcon } from '@shared/tracker/constants'
import type { CalendarData } from './useCalendarData'
import type { CalendarPanelState } from './useCalendarPanel'

/** A row of the side list: an event or a note, a click opens it. */
export interface SideItem extends DayItem {
  text: string
  time: string
  color: string
  icon: string
  open: () => void
}

const NEIGHBOURS = 30
const SIDE_KEY = 'qa.tcalSide'

function readSideW(): number {
  try {
    return Math.min(900, Math.max(320, Number(localStorage.getItem(SIDE_KEY)) || 440))
  } catch {
    return 440
  }
}

/**
 * The side panel's list: the events and notes around the open one, in time order (across the loaded days), grouped
 * by day, the open card kept in the middle; the panel's width (its left edge pulled, remembered).
 */
export function useCalendarSideList(data: CalendarData, panelState: CalendarPanelState) {
  const { panel, openEntry, openNote } = panelState
  const jira = useJira()
  const allItems = computed<SideItem[]>(() => {
    const out: SideItem[] = []
    for (const [day, d] of data.days.value) {
      for (const e of d.entries.filter(data.visibleEntry))
        out.push({ key: e.id, t: e.start, day, text: data.titleOf(e), time: `${formatHM(e.start)}–${formatHM(e.end)}`, color: kindColor(e.kind), icon: entryIcon(e), open: () => openEntry(e, day) })
      for (const n of visibleNotes(d.notes))
        out.push({
          key: n.id,
          t: n.at,
          day,
          text: n.text || n.transcript || (n.audio ? 'Аудиозаметка' : 'Заметка'),
          time: formatHM(n.at),
          color: 'var(--calendar-note)',
          icon: noteIcon(n),
          open: () => openNote(day, { id: n.id, at: n.at, text: n.text, taskId: n.taskId }),
        })
    }
    return out.sort((a, b) => a.t - b.t)
  })
  const neighbours = computed(() => {
    const p = panel.value
    if (!p) return { before: [], after: [] }
    const id = p.type === 'note' ? p.note.id : (p.entry as Partial<Entry>).id
    const at = p.type === 'note' ? p.note.at : p.entry.start
    return neighboursOf(allItems.value, id, at, NEIGHBOURS)
  })
  const beforeGroups = computed(() => byDay(neighbours.value.before))
  const afterGroups = computed(() => byDay(neighbours.value.after))
  /** The open card is kept in the middle of the list. */
  const curEl = ref<HTMLElement>()
  watch(
    () => (panel.value ? (panel.value.type === 'note' ? panel.value.note.id : panel.value.key) : undefined),
    () => void nextTick(() => curEl.value?.scrollIntoView({ block: 'center' })),
  )

  /** The side panel's width: drag its left edge (remembered). */
  const sideW = ref(readSideW())
  const sideDrag = ref(false)
  function onSideResize(e: PointerEvent): void {
    const x0 = e.clientX
    const w0 = sideW.value
    sideDrag.value = true
    document.body.style.cursor = 'col-resize'
    const move = (ev: PointerEvent) => (sideW.value = Math.min(900, Math.max(320, w0 + (x0 - ev.clientX))))
    const up = () => {
      sideDrag.value = false
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', move)
      try {
        localStorage.setItem(SIDE_KEY, String(Math.round(sideW.value)))
      } catch {
        // not remembered — fine
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }
  function openJira(key: string): void {
    if (jira.value.siteUrl) openUrl(`${jira.value.siteUrl}/browse/${key}`)
  }

  return { beforeGroups, afterGroups, curEl, sideW, sideDrag, onSideResize, openJira }
}
