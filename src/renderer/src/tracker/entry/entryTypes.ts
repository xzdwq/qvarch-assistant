import type { Entry, Ms, Note } from '@shared/types'

/** followsNow — the end is "now" (N minutes back); startsNow — the start is "now" (N minutes ahead). */
export type EntryDraft = Omit<Entry, 'id'> & { id?: string; followsNow?: boolean; startsNow?: boolean }

/** How a new block without a picked range is placed: from now, forward or back, N minutes. */
export interface AddPlacement {
  back: boolean
  min: number
}

/** The event card's props (see EntryEditor.vue). */
export interface EntryEditorProps {
  day: string
  entry: EntryDraft
  now?: Ms
  entries: Entry[]
  notes: Note[]
  /** Shown for a new block without a range picked on the timeline. */
  add?: AddPlacement
  /** Saved only by the button (a modal form) — no autosave. */
  manual?: boolean
}

/** The events the card tells its host about. */
export interface EntryEditorEmit {
  /** `day` — where it is now (another day when its date was changed). */
  (e: 'saved', entry: Entry, day: string): void
  /** A copy made on the picked date (the edited event stays). */
  (e: 'copied', entry: Entry, day: string): void
  /** A new event's date was changed — the host may move its marker there. */
  (e: 'day', d: string): void
  (e: 'deleted'): void
  (e: 'close'): void
  /** Draft times changed in the form → move the marker on the timeline. */
  (e: 'range', r: { start: Ms; end: Ms; followsNow: boolean }): void
  (e: 'update:add', a: AddPlacement): void
}

/** A voice dictation recorded for the block (kept as its audio note). */
export type { Dictation } from '../../lib/recorder'
