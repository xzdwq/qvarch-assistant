import { randomUUID } from 'node:crypto'
import { remindAt } from '../../shared/repeat'
import { firstFreeLane, pinLanes, placeEntry, putEntry } from '../../shared/timeline'
import type { Entry } from '../../shared/types'
import type { AppContext } from '../app/appContext'

/** The day's blocks changed: saved, moved (to another day too), deleted — the store saved, the windows told. */

/** An Outlook meeting is read-only here. */
export const OUTLOOK_RO = 'Встреча из Outlook — её меняет только Outlook'

/**
 * A block created or updated (by id). By default overlapping main-line blocks are trimmed; with `overlap` (moving a
 * block) they are left alone and the overlap is shown in parallel.
 */
export function saveEntry(app: AppContext, day: string, input: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }): Entry {
  const { store } = app
  if (!(input.end > input.start)) throw new Error('Конец записи должен быть позже начала')
  const d = store.day(day)
  const prev = input.id ? d.entries.find((e) => e.id === input.id) : undefined
  if (prev?.outlook) throw new Error(OUTLOOK_RO)
  const entry: Entry = { ...prev, ...input, id: input.id ?? randomUUID(), label: input.label.trim(), created: prev?.created ?? input.created ?? (prev ? undefined : Date.now()) }
  if (entry.created === undefined) delete entry.created
  if (!entry.remind) delete entry.remind
  else if (prev?.remind && remindAt(prev.remind, prev.start) !== remindAt(entry.remind, entry.start)) entry.remind = { ...entry.remind, fired: false }
  // a new block dropped over existing ones goes to the first free lane; existing blocks keep theirs
  if (opts?.overlap && !prev && entry.lane === undefined) entry.lane = firstFreeLane(d.entries, entry.start, entry.end, entry.id)
  // with overlaps the resulting layout is frozen into every block's lane — it stays exactly as shown
  d.entries = opts?.overlap ? pinLanes(putEntry(d.entries, entry), entry.id) : placeEntry(d.entries, entry, randomUUID)
  store.markDirty(day)
  store.flush()
  app.broadcast()
  return entry
}
/** A block moved to [start, end] — on the same day, or from `from` to `to` (the task calendar). */
export function moveEntry(app: AppContext, from: string, to: string, id: string, start: number, end: number): void {
  const { store } = app
  if (!(end > start)) throw new Error('Конец должен быть позже начала')
  const a = store.day(from)
  const e = a.entries.find((x) => x.id === id)
  if (!e) throw new Error('Блок не найден')
  if (e.outlook) throw new Error(OUTLOOK_RO)
  if (from === to) {
    a.entries = pinLanes(putEntry(a.entries, { ...e, start, end }), id)
    store.markDirty(from)
  } else {
    const b = store.day(to)
    a.entries = a.entries.filter((x) => x.id !== id)
    const moved = { ...e, start, end, lane: undefined }
    b.entries = pinLanes(putEntry(b.entries, { ...moved, lane: firstFreeLane(b.entries, start, end, id) }), id)
    store.markDirty(from)
    store.markDirty(to)
  }
  store.flush()
  app.broadcast()
}
/** A block deleted (the caller saves and tells the windows). */
export function removeEntry(app: AppContext, day: string, id: string): void {
  const d = app.store.day(day)
  d.entries = d.entries.filter((e) => e.id !== id)
  app.store.markDirty(day)
}
/** A new block on the first free lane of its day (made from a note, a plan…). */
export function addEntryOnFreeLane(app: AppContext, day: string, entry: Entry): Entry {
  const d = app.store.day(day)
  entry.lane = firstFreeLane(d.entries, entry.start, entry.end, entry.id)
  d.entries = pinLanes(putEntry(d.entries, entry), entry.id)
  return entry
}
