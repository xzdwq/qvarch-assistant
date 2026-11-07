import type { SqlMode } from '../../shared/sql'
import type { RunTrigger } from '../../shared/cronJobs'
import type { RunnableKind } from '../blocks/specs'
import { TRIGGER_NAME, type BlockInfo } from '../domain/blockInfo'
import { findLoops } from '../domain/loop'
import { blockRunKey } from '../domain/noteBlocks'
import { envAtLine, NoteEnv, type RunEnv } from './runEnv'
import { runItem, stopItem } from './runItem'
import { itemError, itemIsSoft, itemName, runItemsIn, type BlockItem, type RunItem } from './runItems'
import { stopLoopRun } from './runLoop'
import { noteRun } from './runStore'
import { syncNoteData } from './unrunValues'

/**
 * A note's runs as the app asks for them: «Выполнить всё», one block or loop run where it stands (in the pass shown
 * when it is in a loop), stopped.
 */

/** «Выполнить всё» going on: the note → the item being run and its env (what «Стоп» stops). */
const runAllCurrent = new Map<string, { item: RunItem; env: RunEnv }>()
/** A note's «Выполнить всё» runs, one after another (by hand, by the AI, by a schedule at once — never mixed). */
const runAllQueue = new Map<string, Promise<void>>()
/** Each note's «Стоп» count: a run stops when it changed since the run was asked for (the queued ones too). */
const stopEpoch = new Map<string, number>()
const epochOf = (path: string) => stopEpoch.get(path) ?? 0

/**
 * Everything from the top, in order (a loop — with all its passes); the first failing one (not soft) stops it. What
 * started it is the note's `trigger` value (by hand, by the AI, by a schedule) — its blocks and templates see it.
 * Asked while another run of the note goes — it runs after that one.
 */
export function runAll(path: string, text: string, trigger: RunTrigger = { by: 'hand', at: Date.now() }): Promise<void> {
  const epoch = epochOf(path)
  const run = (runAllQueue.get(path) ?? Promise.resolve()).then(() => runAllNow(path, text, trigger, epoch))
  const settled = run.catch(() => undefined)
  runAllQueue.set(path, settled)
  void settled.then(() => runAllQueue.get(path) === settled && runAllQueue.delete(path))
  return run
}
async function runAllNow(path: string, text: string, trigger: RunTrigger, epoch: number): Promise<void> {
  const n = noteRun(path)
  const stopped = () => epochOf(path) !== epoch
  if (stopped()) return
  syncNoteData(path, text)
  const list = runItemsIn(text)
  const env = new NoteEnv(path)
  env.publish(TRIGGER_NAME, trigger, 'run', TRIGGER_NAME)
  n.all = { at: '', done: 0, total: list.length }
  try {
    for (const [i, x] of list.entries()) {
      if (stopped()) {
        n.all = { ...n.all, error: 'Остановлено' }
        return
      }
      n.all = { at: x.key, done: i, total: list.length }
      runAllCurrent.set(path, { item: x, env })
      const ok = await runItem(x, env, text)
      // a «soft» block's error is expected — the rest go on
      if (!ok && !itemIsSoft(x)) {
        n.all = { at: x.key, done: i, total: list.length, error: itemError(x, env) }
        return
      }
    }
    n.all = undefined
  } finally {
    runAllCurrent.delete(path)
  }
}
/** «Выполнить всё» stopped: no next item, the current one stopped, the queued ones not started. */
export function stopRunAll(path: string): void {
  stopEpoch.set(path, epochOf(path) + 1)
  const cur = runAllCurrent.get(path)
  if (cur) stopItem(cur.item, cur.env)
}

/** A runnable block as its component holds it now (its text may be ahead of the note's): what runs. */
export interface BlockAtLine {
  kind: RunnableKind
  info: BlockInfo
  body: string
  /** Its first line in the note (its env, an unnamed block's key). */
  line: number
}
const itemOf = (b: BlockAtLine): BlockItem => ({ kind: b.kind, info: b.info, body: b.body, key: blockRunKey(b.info.name, b.kind, b.line, b.info.id), line: b.line })

/**
 * A block run by hand where it stands: the note's, or — in a loop — the pass shown again (its values, its result kept
 * with it). Its `trigger` — by hand.
 */
export function runBlockAt(path: string, noteText: string, block: BlockAtLine, opts: { sqlMode?: SqlMode } = {}): Promise<boolean> {
  const env = envAtLine(path, block.line, noteText)
  env.publish(TRIGGER_NAME, { by: 'hand', at: Date.now() } satisfies RunTrigger, 'run', TRIGGER_NAME)
  return runItem(itemOf(block), env, noteText, opts)
}
/** A block's run going on where it stands stopped (in a loop — the pass shown's). */
export function stopBlockAt(path: string, noteText: string, block: Omit<BlockAtLine, 'body'>): void {
  stopItem(itemOf({ ...block, body: '' }), envAtLine(path, block.line, noteText))
}
/** A block run in the note's own env even when it stands in a loop (a regression runs every test as the note's). */
export function runBlockInNote(path: string, noteText: string, block: BlockAtLine): Promise<boolean> {
  return runItem(itemOf(block), new NoteEnv(path), noteText)
}
/** A block's run in the note's own env stopped. */
export function stopBlockInNote(path: string, block: Omit<BlockAtLine, 'body'>): void {
  stopItem(itemOf({ ...block, body: '' }), new NoteEnv(path))
}
/** A loop run where it stands (a loop in a loop — in the outer one's pass shown); false — no closed loop starts there. */
export async function runLoopAt(path: string, noteText: string, line: number): Promise<boolean> {
  const loop = findLoops(noteText.split('\n')).find((l) => l.line0 === line)
  if (!loop || loop.end === undefined) return false
  return runItem({ kind: 'loop', loop, key: loop.key, line }, envAtLine(path, line, noteText), noteText)
}
/** A loop's run going on where it stands stopped: its head, its passes' blocks. */
export function stopLoopAt(path: string, noteText: string, line: number, key: string): void {
  stopLoopRun(envAtLine(path, line, noteText).runSlot(key))
}
/** A runnable block or a loop of the note by its name or key (what the AI tools ask for), in any scope. */
export function runItemNamed(text: string, want: string): RunItem | undefined {
  // (a block left out of batch runs is still run by its name)
  const items = [undefined, ...findLoops(text.split('\n'))].flatMap((l) => runItemsIn(text, l, { withSkipped: true }))
  return items.find((x) => x.key === want || itemName(x) === want)
}
/** An item of the note run where it stands (the AI tools, the harness's checks: a block or a loop by its name); what started it — its `trigger`. */
export function runItemWhereItStands(path: string, noteText: string, item: RunItem, trigger: RunTrigger, recheck?: string[]): Promise<boolean> {
  const env = envAtLine(path, item.line, noteText)
  env.publish(TRIGGER_NAME, trigger, 'run', TRIGGER_NAME)
  return runItem(item, env, noteText, recheck?.length ? { recheck } : {})
}
