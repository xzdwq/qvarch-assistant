import { remapPath } from '@shared/vault'
import { remapHistory } from '@renderer/lib/boardHistory'
import { doc, docs, save, setText } from './noteDocs'
import { closeEverywhere, layout } from './paneLayout'
import { cancelTranscribe } from './transcription'
import { loadTree } from './vaultTreeStore'

/**
 * Open notes kept in step with what happens to their files: a rename / move followed, a change made outside
 * reloaded, a recording's line removed or its transcript put under it.
 */

/** Renamed / moved: open documents and tabs (and a board's undo history) follow. */
export function remap(from: string, to: string): void {
  remapHistory(from, to)
  for (const [k, d] of [...docs]) {
    const n = remapPath(k, from, to)
    if (n !== k) {
      docs.delete(k)
      docs.set(n, d)
    }
  }
  for (const p of layout.panes) {
    for (const t of p.tabs) t.path = remapPath(t.path, from, to)
    if (p.active) p.active = remapPath(p.active, from, to)
  }
  layout.open = layout.open.map((x) => remapPath(x, from, to))
}

/** Changed outside the app: an open note without unsaved typing is reloaded. */
export async function onOutside(paths: string[]): Promise<void> {
  await loadTree()
  for (const p of paths) {
    const d = docs.get(p)
    if (!d || d.text !== d.saved) continue
    try {
      const t = await window.qa.vaultRead(p)
      d.text = t
      d.saved = t
    } catch {
      // deleted outside: its tab closes
      closeEverywhere(p)
    }
  }
}

/** The line of a recording in a note's lines (-1 — not there). */
const recordingLine = (lines: string[], audio: string) => lines.findIndex((l) => l.trim() === `![[${audio}]]`)

/** "Delete the audio, keep the transcript": the recording's line goes, and with it the file. */
export async function dropAudio(path: string, audio: string): Promise<void> {
  cancelTranscribe(audio)
  const d = doc(path)
  const lines = d.text.split('\n')
  const i = recordingLine(lines, audio)
  if (i < 0) return
  lines.splice(i, 1)
  // no double blank line left behind
  if (i < lines.length && i > 0 && !lines[i].trim() && !lines[i - 1].trim()) lines.splice(i, 1)
  setText(path, lines.join('\n'))
  await save(path)
}
/** The transcript goes right under its recording (as plain text — it can be edited). */
export function putTranscript(path: string, audio: string, text: string): void {
  const d = doc(path)
  const lines = d.text.split('\n')
  const i = recordingLine(lines, audio)
  // the recording is no longer in the note: its text is not wanted
  if (i < 0) return
  lines.splice(i + 1, 0, text.trim() || '(тишина — ничего не распознано)', '')
  setText(path, lines.join('\n'))
}
