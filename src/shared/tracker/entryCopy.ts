import { dayStart } from '../timeline'
import type { Entry, Ms } from '../types'

/**
 * A copy of an event: what it takes from it (kind, text, task — never its id, lane, series, reminder or Outlook link)
 * and where it goes — right after it, or on a day and at the times picked.
 */

/** What a copy is made of (an event as the card shows it — maybe edited, not saved yet). */
export type CopySource = Pick<Entry, 'start' | 'end' | 'label' | 'kind'> & Partial<Pick<Entry, 'description' | 'task'>>
export interface CopyPlace {
  start: Ms
  end: Ms
  /** Its lane (none — the first free one). */
  lane?: number
}

/** Right after the event, as long as it. */
export const afterEvent = (e: Pick<Entry, 'start' | 'end'>): CopyPlace => ({ start: e.end, end: e.end + (e.end - e.start) })
/** The same times of day on another day (`from` — the day the times are on now). */
export function sameTimesOn(p: CopyPlace, from: string, to: string): CopyPlace {
  const shift = dayStart(to) - dayStart(from)
  return { start: p.start + shift, end: p.end + shift }
}
/** The new event: the source's kind, text and task at the place given — a plain manual one. */
export function copyDraft(e: CopySource, at: CopyPlace): Omit<Entry, 'id'> {
  return { start: at.start, end: at.end, lane: at.lane, label: e.label, description: e.description, task: e.task, kind: e.kind, source: 'manual' }
}
