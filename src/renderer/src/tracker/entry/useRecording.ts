import { canRecord } from '@shared/tracker/recording'
import type { Entry } from '@shared/types'

/**
 * «Запись» as a screen uses it: a new recorded event begun now; a recording started / stopped on an event — the
 * main process stretches them (it goes on with the window closed); each event says itself whether it is recorded.
 */
export function useRecording() {
  /** A recording begun now: a new event of this kind, its end following the clock. */
  const start = (kind: string, label: string): Promise<Entry> => window.qa.recordStart(kind, label)
  /** A recording on an event started / stopped. */
  const set = (day: string, id: string, on: boolean): Promise<void> => window.qa.recordSet(day, id, on)
  /** What the event's record button / menu item does now: stop it, start it (going on or ahead), or nothing. */
  const action = (e: Pick<Entry, 'recording' | 'end' | 'outlook' | 'source'>, now: number): 'stop' | 'start' | undefined => (e.recording ? 'stop' : canRecord(e, now) ? 'start' : undefined)
  return { start, set, action }
}
