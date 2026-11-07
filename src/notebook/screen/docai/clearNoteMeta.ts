import { clearNoteRuns } from '@nb/engine'
import { forgetDocAi } from '@nb/workspace/docAiStore'
import { forgetAgentLines } from '@nb/workspace/noteAuthors'

/**
 * A note's metadata cleared: its runs (results, screenshots, traces), the AI's memory and journal, its agents' lines —
 * on disk, and what the open note shows now (emptied in place). Its text, colour and emoji stay. A shared note's AI
 * part lives in its shared document (everyone's): it stays.
 */
export async function clearNoteMeta(path: string): Promise<void> {
  await window.qa.vaultClearMeta(path)
  clearNoteRuns(path)
  forgetDocAi(path)
  forgetAgentLines(path)
}
