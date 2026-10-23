import { ref, watch } from 'vue'
import { plainTask, type TaskRef } from '@shared/jira'
import { joinTitle, MINUTE, splitTitle } from '@shared/timeline'
import type { Entry, EntryKind, Ms } from '@shared/types'
import { kindLabel } from '../lib/palette'
import { askSeries } from '../lib/seriesAsk'
import type { IslandDay } from './useIslandDay'
import type { IslandSelection } from './useIslandSelection'
import { OUTLOOK_READONLY } from './useToast'

/** The highlighted block's inline edit form. */
export type EntryDraft = { id: string; start: Ms; end: Ms; label: string; kind: EntryKind; tasks: TaskRef[] }

/** Editing and deleting the highlighted block (for one of a series: it alone or all of them). */
export function useEntryEdit(day: IslandDay, pick: IslandSelection, laneOf: (id: string) => number, flash: (text: string, ok: boolean) => void) {
  const { today, data } = day
  const { entryId, selectedEntry } = pick
  const edit = ref<EntryDraft>()
  watch(entryId, () => (edit.value = undefined))

  function startEdit(e: Entry): void {
    if (e.outlook) return flash(OUTLOOK_READONLY, false)
    edit.value = { id: e.id, start: e.start, end: e.end, label: joinTitle(e.label, e.description), kind: e.kind, tasks: e.task ? [e.task] : [] }
  }

  async function saveEdit(): Promise<void> {
    const ed = edit.value
    const entry = ed && data.value.entries.find((x) => x.id === ed.id)
    if (!ed || !entry) return
    if (ed.end - ed.start < MINUTE) return flash('Слишком короткий отрезок', false)
    const title = splitTitle(ed.label)
    const next = {
      ...entry,
      start: ed.start,
      end: ed.end,
      kind: ed.kind,
      label: title.label || (ed.tasks[0] ? `${ed.tasks[0].key} ${ed.tasks[0].summary}` : kindLabel(ed.kind)),
      description: title.description,
      task: plainTask(ed.tasks[0]),
    }
    // one of a series: this one or all of them
    if (entry.series) {
      const scope = await askSeries('save')
      if (!scope) return
      if (scope === 'all') {
        await window.qa.seriesSave(today.value, next)
        edit.value = undefined
        return flash('Изменения применены ко всей серии', true)
      }
    }
    await window.qa.saveEntry(today.value, { ...next, lane: entry.lane ?? laneOf(entry.id) }, { overlap: true })
    edit.value = undefined
    flash('Изменения сохранены', true)
  }

  /** One block deleted — for a repeated one: it alone or the whole series. */
  async function removeOne(e: Entry): Promise<void> {
    if (e.outlook) return
    if (e.series) {
      const scope = await askSeries('delete')
      if (!scope) return
      if (scope === 'all') return void (await window.qa.seriesDelete(today.value, e.id))
    }
    await window.qa.deleteEntry(today.value, e.id)
  }
  async function removeEntry(): Promise<void> {
    const e = selectedEntry.value
    if (!e) return
    if (e.outlook) return flash(OUTLOOK_READONLY, false)
    await removeOne(e)
    entryId.value = undefined
  }

  return { edit, startEdit, saveEdit, removeOne, removeEntry }
}

export type EntryEdit = ReturnType<typeof useEntryEdit>
