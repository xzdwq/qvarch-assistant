import { copyDraft, type CopyPlace, type CopySource } from '@shared/tracker/entryCopy'
import type { Entry } from '@shared/types'

/** A copy of an event saved on its day (beside what is there — overlaps go parallel). */
export function saveCopy(day: string, source: CopySource, at: CopyPlace): Promise<Entry> {
  return window.qa.saveEntry(day, copyDraft(source, at), { overlap: true })
}
