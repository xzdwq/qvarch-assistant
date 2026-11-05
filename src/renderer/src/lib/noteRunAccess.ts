import { blockReport, loopReport, noteRun, type RunItem } from '@nb/engine'
import { loadedRuns } from '@nb/engine/runStore'
import { loadedDoc } from '@nb/workspace/noteDocs'

/**
 * Running a note's blocks from outside its screen (the AI's tools, the harness's checks): its text as the editor holds
 * it, its results loaded, an item's last run as a report.
 */

/** A note's text as the editor holds it (typed, not saved yet — too). */
export const noteTextOf = async (path: string): Promise<string> => (await loadedDoc(path)).text
/** The note's earlier results read (a run adds to them). */
export const noteRunsLoaded = async (path: string): Promise<void> => void (await loadedRuns(path))
/** An item's last run as a report (a loop — its passes; in a loop's pass, its block — the pass shown). */
export function itemReport(path: string, item: RunItem): string {
  switch (item.kind) {
    case 'loop':
      return loopReport(noteRun(path).loops[item.key], item.loop.info.name ?? item.key)
    default:
      return blockReport(path, item.key, item.kind, item.info, item.body)
  }
}
/** An item's text in the note (a block — its body; a loop — all its lines). */
export function itemText(noteText: string, item: RunItem): string {
  switch (item.kind) {
    case 'loop':
      return noteText
        .split('\n')
        .slice(item.loop.line0, (item.loop.end ?? item.loop.line0) + 1)
        .join('\n')
    default:
      return item.body
  }
}
