import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { isRunnableKind } from '@nb/blocks/specs'
import { blockCaps, type BlockActionId, type BlockCaps } from '@nb/commands/blockActions'
import { splitFence } from '@nb/domain/fence'
import { runBlockAt } from '@nb/engine'
import { COMPONENT_DELETE, COMPONENT_INPUT, editorHost } from '../editorHost'
import { blockSel, setBlockSel } from './blockSelection'
import { componentRanges, type ComponentRange } from './componentField'
import { componentAt, cutPartsOf, wholeComponent } from './componentOps'

/**
 * A handle menu's action carried out: on the block it was opened from — or, when that block is one of the chosen
 * ones, on all of them (in the note's order).
 */

/** The blocks an action of this block's menu is for. */
export function blockTargets(view: EditorView, dom: HTMLElement): ComponentRange[] {
  const r = componentAt(view, dom)
  if (!r) return []
  const sel = blockSel(view)
  if (sel.length < 2 || !sel.includes(r.from)) return [r]
  return componentRanges(view.state).filter((x) => sel.includes(x.from))
}
/** What the blocks of this block's menu can do together. */
export const targetCaps = (view: EditorView, dom: HTMLElement): BlockCaps => blockCaps(blockTargets(view, dom).map((r) => r.kind))

/** The overlapping or touching ranges joined (one change each — a transaction takes no overlaps). */
function joined(parts: Array<{ from: number; to: number }>): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  for (const p of [...parts].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1)
    if (last && p.from <= last.to) last.to = Math.max(last.to, p.to)
    else out.push({ ...p })
  }
  return out
}

/** The blocks run one after another where they stand (a failing one stops the rest; shared code — not run alone). */
async function runInOrder(view: EditorView, rs: ComponentRange[]): Promise<void> {
  const path = view.state.facet(editorHost).notePath()
  for (const r of rs) {
    const kind = r.kind
    if (!isRunnableKind(kind)) continue
    const { info, body } = splitFence(r.src)
    if (info.lib) continue
    const ok = await runBlockAt(path, view.state.doc.toString(), { kind, info, body, line: r.line })
    if (!ok && !info.soft) return
  }
}

type ActionRun = (view: EditorView, rs: ComponentRange[]) => void
/** Each action (but «as Markdown» — the block's own view does it) on its blocks. */
const ACTION_RUNS: Record<Exclude<BlockActionId, 'raw'>, ActionRun> = {
  run: (view, rs) => void runInOrder(view, rs),
  // as Markdown: pasted into a note they are the same blocks again (a loop — with all it holds)
  copy: (view, rs) => void navigator.clipboard.writeText(`${rs.map((r) => wholeComponent(view, r).src).join('\n\n')}\n`),
  // the copies under the last one, in their order
  dup: (view, rs) => {
    const whole = rs.map((r) => wholeComponent(view, r))
    const at = Math.max(...whole.map((r) => r.to))
    view.dispatch({ changes: { from: at, insert: `\n\n${whole.map((r) => r.src).join('\n\n')}` }, effects: setBlockSel.of([]), annotations: Transaction.userEvent.of(COMPONENT_INPUT) })
  },
  del: (view, rs) => {
    const parts = joined(rs.flatMap((r) => cutPartsOf(view, r)))
    view.dispatch({ changes: parts, selection: { anchor: parts[0].from }, effects: setBlockSel.of([]), annotations: Transaction.userEvent.of(COMPONENT_DELETE) })
    view.focus()
  },
}
/** An action of this block's menu done. */
export function runBlockAction(view: EditorView, dom: HTMLElement, id: Exclude<BlockActionId, 'raw'>): void {
  const rs = blockTargets(view, dom)
  if (rs.length) ACTION_RUNS[id](view, rs)
}
