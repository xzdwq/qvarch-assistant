import { computed, ref } from 'vue'
import { splitTitle } from '@shared/timeline'
import type { Entry, Ms } from '@shared/types'
import { VOICE_PENDING } from '@shared/voice'
import { plainTask, type TaskRef } from '@shared/jira'
import { kindLabel } from '../../lib/palette'
import { saveRecording } from '../../lib/recorder'
import { askSeries } from '../../lib/seriesAsk'
import { blockLabel, errorText, placeByQuickLine } from '@shared/tracker/entryForm'
import type { Dictation, EntryEditorEmit, EntryEditorProps } from './entryTypes'
import type { EntryForm } from './useEntryForm'
import type { EntryReminder } from './useEntryReminder'

/** What the card does with the event: save (a series asks this one / all), copy to the picked date, delete. */
export function useEntryActions(props: EntryEditorProps, emit: EntryEditorEmit, form: EntryForm, rem: EntryReminder) {
  const { start, label, kind, tasks, error, busy, isNew, readonly, date, dayShift, effectiveEnd, followsNow, parsed } = form
  /** A series asks once per editing: this one or all of them. */
  let seriesScope: 'one' | 'all' | undefined
  const forgetSeriesScope = () => (seriesScope = undefined)

  /** An existing event whose date was changed: saved where it is, then moved to that date (the same times of day). */
  async function moveToDate(e: Entry): Promise<Entry> {
    const shift = dayShift()
    if (!shift) return e
    await window.qa.moveEntry(props.day, date.value, e.id, e.start + shift, e.end + shift)
    return { ...e, start: e.start + shift, end: e.end + shift }
  }

  /** The whole series takes the form (only this one goes to another date). */
  async function saveSeries(endT: Ms): Promise<void> {
    const parts = splitTitle(label.value)
    const t = tasks.value[0] ? plainTask(tasks.value[0]) : undefined
    const next: Entry = {
      ...(props.entry as Entry),
      start: start.value,
      end: endT,
      label: blockLabel(parts.label, t, kindLabel(kind.value)),
      description: parts.description,
      task: t,
      kind: kind.value,
      remind: rem.remind.value,
    }
    await window.qa.seriesSave(props.day, next)
    emit('saved', await moveToDate(next), date.value)
  }

  /** Saves the form; `auto` — an autosave of an existing event (a series asks only once). Returns whether it was saved. */
  async function save(dict?: Dictation, auto = false): Promise<boolean> {
    error.value = ''
    const endT = effectiveEnd.value
    if (!(endT > start.value)) {
      error.value = 'Конец должен быть позже начала'
      return false
    }
    busy.value = true
    try {
      // an Outlook meeting: only its reminder
      if (readonly.value && props.entry.id) {
        await window.qa.setRemind(props.day, props.entry.id, rem.remind.value ?? null)
        emit('saved', { ...(props.entry as Entry), remind: rem.remind.value }, props.day)
        return true
      }
      // one of a series: this one, or all of them
      if (props.entry.id && props.entry.series) {
        const scope = auto && seriesScope ? seriesScope : await askSeries('save')
        if (!scope) return false
        seriesScope = scope
        if (scope === 'all') {
          await saveSeries(endT)
          return true
        }
      }
      const { followsNow: _f, startsNow: _n, ...base } = props.entry
      // a new event goes to its date at once; an existing one is saved on its day and moved after
      let place = { day: isNew.value ? date.value : props.day, start: start.value + (isNew.value ? dayShift() : 0), end: endT + (isNew.value ? dayShift() : 0) }
      let title = splitTitle(label.value).label
      const qp = isNew.value ? parsed.value : undefined
      const taskList = [...tasks.value]
      if (qp) {
        // a new event: what its quick line says wins over the form (time, duration, day, task; the title is the rest)
        title = qp.q.label
        place = placeByQuickLine({ ...place, followsNow: followsNow.value }, qp.q)
        if (qp.task && !taskList.some((x) => x.key === qp.task!.key)) taskList.push(qp.task)
        if (!(place.end > place.start)) {
          error.value = 'Конец должен быть позже начала'
          return false
        }
      }
      let day = place.day
      // a new block linked to several tasks → one parallel block per task
      const targets: Array<TaskRef | undefined> = taskList.length ? taskList.map(plainTask) : [undefined]
      let saved: Entry | undefined
      for (const [n, t] of targets.entries()) {
        const r = await window.qa.saveEntry(day, {
          ...base,
          start: place.start,
          end: place.end,
          // dictated: a placeholder until the transcript fills it
          label: blockLabel(title, t, kindLabel(kind.value), dict ? VOICE_PENDING : undefined),
          description: splitTitle(label.value).description,
          task: t,
          kind: kind.value,
          source: props.entry.id ? props.entry.source : 'manual',
          remind: rem.remind.value,
          // only the first one replaces the edited block; the rest are new
          ...(n > 0 ? { id: undefined, lane: undefined, series: undefined } : {}),
        }, { overlap: true })
        saved ??= r
      }
      // the dictation is kept as an audio note of the block; its transcript fills the block's text
      if (dict && saved) void saveRecording(day, { ...dict, at: place.start }, { entryId: saved.id })
      // a new block with a repeat: its copies every hour / day / week / year
      if (saved && !props.entry.id && rem.repeatRule.value) await window.qa.repeatEntry(day, saved.id, rem.repeatRule.value, rem.repeatCount.value)
      if (saved && props.entry.id) {
        saved = await moveToDate(saved)
        day = date.value
      }
      if (saved) emit('saved', saved, day)
      return !!saved
    } catch (e) {
      error.value = errorText(e)
      return false
    } finally {
      busy.value = false
    }
  }

  /**
   * A copy of the event on the picked date — the event itself stays where it is (its date goes back). On its own
   * day the copy follows it (done before lunch — again after), on another day it takes the same times.
   */
  const copiedTo = ref('')
  const copyTitle = computed(() =>
    date.value === props.day ? 'Копия сразу после этого события' : `Копия на ${new Date(`${date.value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, в то же время; это событие остаётся`,
  )
  async function copyToDate(): Promise<void> {
    if (!props.entry.id || busy.value) return
    const target = date.value
    const dur = effectiveEnd.value - start.value
    const s = target === props.day ? effectiveEnd.value : start.value + dayShift()
    const parts = splitTitle(label.value)
    const t = tasks.value[0] ? plainTask(tasks.value[0]) : undefined
    busy.value = true
    error.value = ''
    try {
      const c = await window.qa.saveEntry(
        target,
        { start: s, end: s + dur, label: blockLabel(parts.label, t, kindLabel(kind.value)), description: parts.description, task: t, kind: kind.value, source: 'manual' },
        { overlap: true },
      )
      date.value = props.day
      const hm = (x: Ms) => new Date(x).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      copiedTo.value = `${new Date(`${target}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })} ${hm(c.start)}–${hm(c.end)}`
      emit('copied', c, target)
    } catch (e) {
      error.value = errorText(e)
    } finally {
      busy.value = false
    }
  }

  /** Deletes the event (a series asks: this one or all). A draft just closes. */
  async function remove(): Promise<void> {
    if (!props.entry.id) return emit('close')
    if (props.entry.series) {
      const scope = await askSeries('delete')
      if (!scope) return
      if (scope === 'all') {
        await window.qa.seriesDelete(props.day, props.entry.id)
        return emit('deleted')
      }
    }
    await window.qa.deleteEntry(props.day, props.entry.id)
    emit('deleted')
  }

  return { save, copyToDate, copiedTo, copyTitle, remove, forgetSeriesScope }
}
