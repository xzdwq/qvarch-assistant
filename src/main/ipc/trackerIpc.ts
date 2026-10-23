import { randomUUID } from 'node:crypto'
import { remindAt } from '../../shared/repeat'
import { dayEnd, dayKey, mergeEntries, pinLanes, putEntry } from '../../shared/timeline'
import type { Entry, Note } from '../../shared/types'
import type { AppContext } from '../app/appContext'
import { addEntryOnFreeLane, moveEntry, OUTLOOK_RO, removeEntry, saveEntry } from '../tracker/dayEdits'
import type { Series } from '../tracker/series'
import { handle, listen } from './router'

/** The time tracker's window calls: the day's blocks, notes, plan, tasks of the day, repeats, the cut marker. */
export function registerTrackerIpc(app: AppContext, series: Series): void {
  const { store } = app
  /** The day changed: saved now, the windows told. */
  const changed = (day: string) => {
    store.markDirty(day)
    store.flush()
    app.broadcast()
  }

  handle('getDay', (_e, day) => store.day(day))
  handle('getLive', () => ({ ...app.tracker.live, now: Date.now() }))
  handle('saveEntry', (_e, day, input, opts) => saveEntry(app, day, input, opts))
  handle('mergeEntries', (_e, day, ids) => {
    const d = store.day(day)
    if (d.entries.some((e) => ids.includes(e.id) && e.outlook)) throw new Error(OUTLOOK_RO)
    const r = mergeEntries(d.entries, ids)
    if (!r) return undefined
    d.entries = pinLanes(
      putEntry(
        d.entries.filter((e) => !r.removed.includes(e.id)),
        r.merged,
      ),
    )
    changed(day)
    return r.merged
  })
  handle('moveEntry', (_e, from, to, id, start, end) => moveEntry(app, from, to, id, start, end))
  handle('deleteEntry', (_e, day, id) => {
    if (store.day(day).entries.find((e) => e.id === id)?.outlook) throw new Error(OUTLOOK_RO)
    removeEntry(app, day, id)
    store.flush()
    app.broadcast()
  })

  // ---------- repeats & reminders ----------
  handle('repeatEntry', (_e, day, id, rule, count) => series.repeat(day, id, rule, count))
  handle('seriesSave', (_e, day, input) => series.save(day, input))
  handle('seriesDelete', (_e, day, id) => series.remove(day, id))
  handle('setRemind', (_e, day, id, remind) => {
    const e = store.day(day).entries.find((x) => x.id === id)
    if (!e) return
    if (remind) e.remind = { before: remind.before, at: remind.at }
    else delete e.remind
    changed(day)
  })

  // ---------- quick notes ----------
  handle('saveNote', (_e, day, input) => {
    const d = store.day(day)
    const prev = d.notes.find((n) => n.id === input.id)
    const note: Note = { ...prev, id: input.id, at: input.at, text: input.text, updatedAt: Date.now() }
    // undefined — the reminder stays as it was; null — removed; a new time — it will fire again
    if (input.remind === null) delete note.remind
    else if (input.remind) note.remind = remindAt(input.remind, note.at) === remindAt(prev?.remind, note.at) && prev?.remind ? prev.remind : { at: input.remind.at, before: input.remind.before }
    d.notes = [...d.notes.filter((n) => n.id !== note.id), note]
    changed(day)
    return note
  })
  handle('deleteNote', (_e, day, id) => {
    const d = store.day(day)
    const audio = d.notes.find((n) => n.id === id)?.audio
    // a transcription still running / queued for this note is stopped first (process killed, temp files removed)
    app.voice.cancel(id)
    if (audio) app.voice.removeAudio(audio.file)
    d.notes = d.notes.filter((n) => n.id !== id)
    changed(day)
  })
  handle('noteToTask', (_e, day, noteId) => {
    const d = store.day(day)
    const n = d.notes.find((x) => x.id === noteId)
    if (!n) throw new Error('Заметка не найдена')
    // the note becomes a "Задача" block on the timeline (now, 30 min); the note goes
    const text = (n.text.trim() || n.transcript?.trim() || '').replace(/\r/g, '')
    const [first, ...rest] = text.split('\n')
    const title = (first ?? '').replace(/^[#>*\-\s]+/, '').slice(0, 160) || 'Задача из заметки'
    const description = [rest.join('\n').trim(), n.transcript && n.text.trim() ? `Расшифровка:\n${n.transcript}` : ''].filter(Boolean).join('\n\n') || undefined
    const start = day === dayKey(Date.now()) ? Math.floor(Date.now() / 60_000) * 60_000 : n.at
    const entry = addEntryOnFreeLane(app, day, { id: randomUUID(), start, end: Math.min(dayEnd(day), start + 30 * 60_000), kind: 'task', label: title, description, source: 'manual', ...(n.remind ? { remind: n.remind } : {}) })
    app.voice.cancel(noteId)
    if (n.audio) app.voice.removeAudio(n.audio.file)
    d.notes = d.notes.filter((x) => x.id !== noteId)
    changed(day)
    return entry
  })

  // ---------- the plan ----------
  handle('savePlan', (_e, day, block) => {
    if (!(block.end > block.start)) throw new Error('Конец должен быть позже начала')
    const d = store.day(day)
    const prev = (d.plan ?? []).find((p) => p.id === block.id)
    d.plan = [...(d.plan ?? []).filter((p) => p.id !== block.id), { ...prev, ...block, label: block.label.trim() }]
    changed(day)
    return block
  })
  handle('deletePlan', (_e, day, id) => {
    const d = store.day(day)
    d.plan = (d.plan ?? []).filter((p) => p.id !== id)
    changed(day)
  })
  handle('planDone', (_e, day, id) => {
    const d = store.day(day)
    const p = (d.plan ?? []).find((x) => x.id === id)
    if (!p) return undefined
    // pressed again (or from another place) — the block is already there
    const made = p.doneEntryId ? d.entries.find((e) => e.id === p.doneEntryId) : undefined
    if (made) return made
    const entry: Entry = addEntryOnFreeLane(app, day, { id: randomUUID(), start: p.start, end: p.end, kind: p.kind, label: p.label, ...(p.task ? { task: { key: p.task.key, summary: p.task.summary } } : {}), source: 'manual' })
    p.doneEntryId = entry.id
    changed(day)
    return entry
  })

  // ---------- «Моя работа»: the tasks of the day, a block's task ----------
  const taskRef = (t: unknown): { key: string; summary: string } | undefined => {
    const x = t as { key?: unknown; summary?: unknown } | null
    return x && typeof x.key === 'string' && x.key.trim() ? { key: x.key.trim(), summary: typeof x.summary === 'string' ? x.summary : '' } : undefined
  }
  handle('setDayTasks', (_e, day, tasks) => {
    const d = store.day(day)
    const list = (Array.isArray(tasks) ? tasks : []).map(taskRef).filter((x): x is { key: string; summary: string } => !!x)
    // each task once
    d.dayTasks = list.filter((t, i) => list.findIndex((x) => x.key === t.key) === i)
    changed(day)
  })
  handle('setEntryTask', (_e, day, id, task) => {
    const e = store.day(day).entries.find((x) => x.id === id)
    if (!e) throw new Error('Запись не найдена')
    // an Outlook meeting too: only its task changes (time and title stay Outlook's)
    const t = task === null ? undefined : taskRef(task)
    if (t) e.task = t
    else delete e.task
    changed(day)
  })

  // ---------- own tasks ----------
  const tasksChanged = () => app.emitToAll('onTasks', store.tasks())
  handle('tasks', () => store.tasks())
  handle('saveTask', (_e, t) => {
    const task = store.putTask({ ...t, title: t.title.trim() || 'Без названия' })
    tasksChanged()
    app.broadcast() // a renamed task shows its new title on the calendar / blocks
    return task
  })
  handle('deleteTask', (_e, id) => {
    store.deleteTask(id)
    // notes made into this task are unlinked
    for (const day of store.listDays()) {
      const d = store.day(day)
      if (d.notes.some((n) => n.taskId === id)) {
        for (const n of d.notes) if (n.taskId === id) delete n.taskId
        store.markDirty(day)
      }
    }
    store.flush()
    tasksChanged()
    app.broadcast()
  })

  // ---------- the cut marker ----------
  handle('getSelection', () => app.selection)
  listen('setSelection', (_e, sel) => {
    app.selection = sel
    app.broadcast()
  })
}
