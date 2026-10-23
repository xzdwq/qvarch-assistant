import type { Recent } from '../../components/LabelInput.vue'
import type { Entry, Ms, Note } from '@shared/types'

/** followsNow — the end is "now" (N minutes back); startsNow — the start is "now" (N minutes ahead). */
export type EntryDraft = Omit<Entry, 'id'> & { id?: string; followsNow?: boolean; startsNow?: boolean }

/** How a new block without a picked range is placed: from now / the cursor, forward or back, N minutes. */
export interface AddPlacement {
  from: 'now' | 'cursor'
  back: boolean
  min: number
}

/** The event card's props (see EntryEditor.vue). */
export interface EntryEditorProps {
  day: string
  entry: EntryDraft
  recent: Recent[]
  now?: Ms
  entries: Entry[]
  notes: Note[]
  /** Shown for a new block without a range picked on the timeline. */
  add?: AddPlacement
  /** A moment was clicked on the timeline ("от курсора" is possible). */
  hasCursor?: boolean
  /** A plain multi-line field (Enter — a new line, the height can be pulled) instead of the one-line input. */
  textarea?: boolean
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
