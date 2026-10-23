import { computed } from 'vue'
import { noteEntry, visibleNotes } from '@shared/notes'
import { formatHM } from '@shared/timeline'
import type { DayData, Note } from '@shared/types'
import { kindLabel } from '../../lib/palette'
import { clusterize, useFan } from '../../lib/pinfan'
import type { TimelineScale } from './useTimelineScale'

/** Pin spacing on the schedule row when a group fans out, px. */
const PIN_STEP = 19
/** Pins closer than this (px) form one group. */
const PIN_GAP = 15

/**
 * Quick notes in view as pins on the schedule row; notes at (almost) the same moment spread apart on hover,
 * and the zone under a fanned-out group keeps it open while the pointer crosses it.
 */
export function useTimelineNotePins(props: { data: DayData }, scale: TimelineScale) {
  const { from, to, pct, width } = scale
  const notePins = computed(() => visibleNotes(props.data.notes).filter((n) => n.at >= from.value && n.at <= to.value))
  const fan = useFan()
  const pinPlaces = computed(() => clusterize(notePins.value, (n) => (pct(n.at) / 100) * width.value, PIN_GAP))
  const fanZone = computed(() => {
    const k = fan.open.value
    const n = k ? (pinPlaces.value.get(k)?.n ?? 1) : 1
    const p = k && notePins.value.find((x) => x.id === k)
    return p && n > 1 ? { pct: pct(p.at), width: (n - 1) * PIN_STEP + 26 } : undefined
  })
  /** The tooltip: the time, the block it belongs to, the text. */
  function noteTitle(n: Note): string {
    const e = noteEntry(n, props.data.entries)
    return `Заметка ${formatHM(n.at)}${e ? ` · ${kindLabel(e.kind)}${e.label && e.label !== kindLabel(e.kind) ? ` «${e.label}»` : ''}` : ''}\n${n.text}`
  }
  return { notePins, fan, pinPlaces, fanZone, noteTitle }
}
