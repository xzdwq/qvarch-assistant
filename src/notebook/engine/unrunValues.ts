import { blockSpec, isRunnableKind } from '../blocks/specs'
import { tableValue } from '../blocks/table/model'
import type { BlockInfo } from '../domain/blockInfo'
import type { BlockKind } from '../domain/blockSpec'
import { findLoops, loopAt } from '../domain/loop'
import { blockRunKey, fencedBlocksOf } from '../domain/noteBlocks'
import { tableVars } from '../domain/tableVars'
import { noteRun, noteValues, publishToNote, saveRunsSoon } from './runStore'

/**
 * The note's values its text gives with no run, kept published: the blocks whose kind's spec says so
 * (publishWithoutRun — data, templates) and the tables (by their variables).
 */

/**
 * A block whose kind is published with no run: its value put into the note's context when it changed (the
 * component's text may be ahead of the note's); what is wrong with its text, if anything.
 */
export function publishUnrun(path: string, kind: BlockKind, info: BlockInfo, body: string): string | undefined {
  const how = blockSpec(kind).publishWithoutRun
  if (!how || !info.name) return undefined
  const r = how.valueOf(body, info, how.usesValues ? noteValues(path) : {})
  if (!r) return undefined
  if ('error' in r) return r.error
  const cur = noteRun(path).ctx[info.name]
  if (!cur || JSON.stringify(cur.value) !== JSON.stringify(r.value)) publishToNote(path, info.name, r.value, how.source, blockRunKey(info.name, kind, 0, info.id))
  return undefined
}
/**
 * The note's blocks published with no run — the ones filled from its values, or the ones whose text alone gives
 * theirs. A kind that also runs — only outside loops and not a «lib» (a loop's pass runs it with its own values).
 */
function publishUnrunBlocks(path: string, text: string, usesValues: boolean): void {
  const loops = findLoops(text.split('\n'))
  for (const b of fencedBlocksOf(text)) {
    const how = blockSpec(b.kind).publishWithoutRun
    if (!how || how.usesValues !== usesValues) continue
    if (isRunnableKind(b.kind) && (b.info.lib || loopAt(loops, b.line0))) continue
    publishUnrun(path, b.kind, b.info, b.body)
  }
}
/** The note's data published (the blocks not on screen too): what its text alone gives (data blocks), its tables. */
export function syncNoteData(path: string, text: string): void {
  publishUnrunBlocks(path, text, false)
  syncTables(path, text)
}
/**
 * The note's blocks filled from its values (templates) published whenever they can be filled — the ones not on
 * screen too: run after the text changes and after the note's values do (a template over a template settles in a
 * round or two — a value published only when it changed).
 */
export function syncTemplates(path: string, text: string): void {
  publishUnrunBlocks(path, text, true)
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
