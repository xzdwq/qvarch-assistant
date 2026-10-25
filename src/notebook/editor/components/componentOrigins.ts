import { Transaction } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { markOrigin } from '@nb/workspace/sharedPlaces'
import { serverNow, useTransport } from '@renderer/lib/transport'
import { COMPONENT_MOVE, editorHost } from '../editorHost'
import { componentRangesField } from './componentField'

/**
 * Who put a component into a shared note: any component that appears by this person's edit — put in by «@», a
 * picture, a recording, pasted, typed by hand — is marked as theirs, at the server's time. Not: the others' edits
 * (they come marked `remote`), a component moved (its origin goes with it — dragDrop). One rule for every kind.
 */
function newComponents(u: ViewUpdate): number[] {
  const local = u.transactions.some((tr) => tr.docChanged && !tr.annotation(Transaction.remote) && !tr.isUserEvent(COMPONENT_MOVE))
  if (!local) return []
  const had = new Set(u.startState.field(componentRangesField).map((r) => u.changes.mapPos(r.from, 1)))
  const inserted: Array<[number, number]> = []
  u.changes.iterChangedRanges((_fa, _ta, fromB, toB) => void (toB > fromB && inserted.push([fromB, toB])))
  return u.state
    .field(componentRangesField)
    .map((r) => r.from)
    .filter((at) => !had.has(at) && inserted.some(([a, b]) => at >= a && at < b))
}

/** (after the editor's own listener: the note's text is the editor's by then — the mark's place is right) */
export const componentOrigins = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return
  const starts = newComponents(u)
  if (!starts.length) return
  const path = u.state.facet(editorHost).notePath()
  const t = useTransport().value
  for (const at of starts) markOrigin(path, at, { by: t.name ?? '', device: t.deviceId, at: serverNow() })
})
