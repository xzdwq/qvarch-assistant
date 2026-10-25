import { load as yamlLoad } from 'js-yaml'
import type { SqlMode } from '../../shared/sql'
import type { RunnableKind } from '../blocks/specs'
import type { BlockInfo, ValueSource } from '../domain/blockInfo'
import { findLoops } from '../domain/loop'
import { blockRunKey, fencedBlocksOf } from '../domain/noteBlocks'
import { tableVars } from '../domain/tableVars'
import { tableValue } from '../blocks/table/model'
import { interpolate } from '../domain/values'
import { errorText } from './runApi'
import { envAtLine, NoteEnv, type RunEnv } from './runEnv'
import { runItem, stopItem } from './runItem'
import { itemError, itemIsSoft, itemName, runItemsIn, type BlockItem, type RunItem } from './runItems'
import { stopLoopRun } from './runLoop'
import { noteRun, noteValues, publishToNote, saveRunsSoon } from './runStore'

/**
 * A note's runs as the app asks for them: «Выполнить всё», one block or loop run where it stands (in the pass shown
 * when it is in a loop), stopped; the data blocks, tables and templates kept published.
 */

/** «Выполнить всё» going on: the note → the item being run and its env (what «Стоп» stops). */
const runAllCurrent = new Map<string, { item: RunItem; env: RunEnv }>()
/** The notes whose «Выполнить всё» was asked to stop. */
const stopAllAsked = new Set<string>()

/** Everything from the top, in order (a loop — with all its passes); the first failing one (not soft) stops it. */
export async function runAll(path: string, text: string): Promise<void> {
  const n = noteRun(path)
  syncNoteData(path, text)
  const list = runItemsIn(text)
  const env = new NoteEnv(path)
  stopAllAsked.delete(path)
  n.all = { at: '', done: 0, total: list.length }
  try {
    for (const [i, x] of list.entries()) {
      if (stopAllAsked.has(path)) {
        stopAllAsked.delete(path)
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
/** «Выполнить всё» stopped: no next item, the current one stopped. */
export function stopRunAll(path: string): void {
  stopAllAsked.add(path)
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

/** A block run where it stands: the note's, or — in a loop — the pass shown again (its values, its result kept with it). */
export function runBlockAt(path: string, noteText: string, block: BlockAtLine, opts: { sqlMode?: SqlMode } = {}): Promise<boolean> {
  return runItem(itemOf(block), envAtLine(path, block.line, noteText), noteText, opts)
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
  const items = [undefined, ...findLoops(text.split('\n'))].flatMap((l) => runItemsIn(text, l))
  return items.find((x) => x.key === want || itemName(x) === want)
}
/** An item of the note run where it stands (the AI tools: a block or a loop by its name). */
export function runItemWhereItStands(path: string, noteText: string, item: RunItem): Promise<boolean> {
  return runItem(item, envAtLine(path, item.line, noteText), noteText)
}

// ---------- data and templates: published without a run ----------
/** A data block's value (JSON / YAML) put into the context — as soon as it parses; the parse error, if any. */
export function publishData(path: string, name: string, lang: string, body: string): string | undefined {
  try {
    const v = lang === 'yaml' ? yamlLoad(body) : JSON.parse(body || 'null')
    const cur = noteRun(path).ctx[name]
    if (!cur || JSON.stringify(cur.value) !== JSON.stringify(v)) publishToNote(path, name, v, 'data', name)
    return undefined
  } catch (e) {
    return errorText(e).split('\n')[0]
  }
}
/** A value put into the note's context from outside a run (the browser component's requests). */
export function publishValue(path: string, name: string, value: unknown, from: ValueSource, block: string): void {
  publishToNote(path, name, value, from, block)
}
/** The note's data published (the blocks not on screen too): its data blocks, its tables. */
export function syncNoteData(path: string, text: string): void {
  for (const b of fencedBlocksOf(text)) if (b.kind === 'data' && b.info.name) publishData(path, b.info.name, b.info.lang, b.body)
  syncTables(path, text)
}
/**
 * Every table published under its variable (its rows as objects) when its content changed; a variable a table gave
 * that no table gives now (renamed, deleted) taken away — the values of other blocks are never touched.
 */
function syncTables(path: string, text: string): void {
  const ctx = noteRun(path).ctx
  const live = new Set<string>()
  for (const v of tableVars(text)) {
    if (v.clash) continue
    live.add(v.name)
    const value = tableValue(v.table)
    const cur = ctx[v.name]
    if (!cur || cur.from !== 'table' || JSON.stringify(cur.value) !== JSON.stringify(value)) publishToNote(path, v.name, value, 'table', v.name)
  }
  const gone = Object.keys(ctx).filter((k) => ctx[k].from === 'table' && !live.has(k))
  for (const k of gone) delete ctx[k]
  if (gone.length) saveRunsSoon(path)
}
/**
 * The note's templates (not in a loop) published under their names whenever they can be filled — the ones not on
 * screen too: run after the text changes and after the note's values do (a template over a template settles in a
 * round or two — a value published only when it changed).
 */
export function syncTemplates(path: string, text: string): void {
  const ctx = noteValues(path)
  for (const x of runItemsIn(text)) {
    if (x.kind !== 'tpl' || !x.info.name) continue
    const r = interpolate(x.body, ctx)
    const cur = noteRun(path).ctx[x.info.name]
    if (!r.missing.length && cur?.value !== r.text) publishToNote(path, x.info.name, r.text, 'tpl', x.key)
  }
}
