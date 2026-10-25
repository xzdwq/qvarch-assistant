import { Annotation, EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { blockIdFixes, newBlockId, type IdFix } from '@nb/domain/blockIds'
import { fencedBlocksOf } from '@nb/domain/noteBlocks'
import { moveRun } from '@nb/engine/runStore'
import { editorHost } from '../editorHost'

/**
 * Every runnable block keeps an id of its own (blockIds): this person's edit that touches a fence — a block put in,
 * pasted, duplicated, typed — gets the ids its blocks lack (or a copy's) in the same change (one step to undo; a new
 * block never shows another's results, not even for a moment). A block that was in the note before the change keeps
 * its results; one that was not — starts empty. The others' edits are theirs to fix (ids given at once would clash).
 */
const FENCE = /```|~~~/
const idsGiven = Annotation.define<IdFix[]>()

const giveIds = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(Transaction.remote)) return tr
  let touched = false
  tr.changes.iterChanges((_fa, _ta, _fb, _tb, ins) => void (touched ||= FENCE.test(ins.toString())))
  if (!touched) return tr
  const doc = tr.newDoc
  // the blocks there before (where they start now): theirs are their results
  const old = tr.startState.doc
  const before = new Set(fencedBlocksOf(old.toString()).map((b) => tr.changes.mapPos(old.line(b.line0).from, 1)))
  const fixes = blockIdFixes(doc.toString(), newBlockId, (line0) => before.has(doc.line(line0).from))
  if (!fixes.length) return tr
  return [tr, { changes: fixes.map((f) => ({ from: doc.line(f.line0).from, to: doc.line(f.line0).to, insert: f.infoLine })), sequential: true, annotations: idsGiven.of(fixes) }]
})
/** A block that was there: its results moved to its new key once its id is in. */
const moveResults = EditorView.updateListener.of((u) => {
  for (const tr of u.transactions)
    for (const f of tr.annotation(idsGiven) ?? []) if (f.was) moveRun(u.state.facet(editorHost).notePath(), f.was, f.key)
})

export const blockIdentity = [giveIds, moveResults]
