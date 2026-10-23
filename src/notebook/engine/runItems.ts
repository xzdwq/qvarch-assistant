import { toRaw } from 'vue'
import { isRunnableKind, type RunnableKind } from '../blocks/specs'
import { isTsLang, type BlockInfo } from '../domain/blockInfo'
import { findLoops, loopAt, type LoopRange } from '../domain/loop'
import { fencedBlocksOf } from '../domain/noteBlocks'
import { findBlocks } from '../domain/findBlocks'
import type { RunEnv } from './runEnv'
import { noteRun } from './runStore'

/**
 * What runs, in order: the runnable blocks and the loops of a scope (the note's top, or a loop's body) — a loop as
 * one item (its blocks run by its passes).
 */
export type BlockItem = { kind: RunnableKind; info: BlockInfo; body: string; key: string; line: number }
export type LoopItem = { kind: 'loop'; loop: LoopRange; key: string; line: number }
export type RunItem = BlockItem | LoopItem

/** The runnable things right inside a loop (none — the note's top): its blocks, the loops in it (not their insides). */
export function runItemsIn(text: string, loop?: LoopRange): RunItem[] {
  const lines = text.split('\n')
  const loops = findLoops(lines)
  const owner = (line: number) => loopAt(loops, line)?.key
  const out: RunItem[] = []
  const fenced = new Map(fencedBlocksOf(text).map((b) => [b.line0, b]))
  for (const b of findBlocks(lines)) {
    if (b.kind === 'loop') {
      const l = loops.find((x) => x.line0 === b.line0)
      if (l && l.end !== undefined && l.parent === loop?.key) out.push({ kind: 'loop', loop: l, key: l.key, line: l.line0 })
      continue
    }
    const f = fenced.get(b.line0)
    if (!f || !isRunnableKind(b.kind) || owner(b.line0) !== loop?.key || f.info.lib) continue
    out.push({ kind: b.kind, info: f.info, body: f.body, key: f.key, line: b.line0 })
  }
  return out
}
/** An item's published name (a block's name=, a loop's name=). */
export const itemName = (x: RunItem) => (x.kind === 'loop' ? x.loop.info.name : x.info.name)
/** An item's error does not stop the run (soft). */
export const itemIsSoft = (x: RunItem) => (x.kind === 'loop' ? !!x.loop.info.soft : !!x.info.soft)
/** What went wrong with an item's last run in an env. */
export const itemError = (x: RunItem, env: RunEnv) => (x.kind === 'loop' ? env.loops[x.key]?.error : env.runs[x.key]?.error) ?? 'Ошибка'

/** A Playwright block anywhere in a loop (in a loop inside it too): its files are the block's — passes one by one. */
export function loopHasPw(text: string, loop: LoopRange): boolean {
  if (loop.end === undefined) return false
  return findBlocks(text.split('\n')).some((b) => b.kind === 'pw' && b.line0 > loop.headEnd && b.line1 < loop.end!)
}

/** The note's shared functions (its «lib» code blocks) but the code given. */
export function libsOf(noteText: string, code: string): Array<{ code: string; ts: boolean }> {
  return fencedBlocksOf(noteText)
    .filter((b) => b.kind === 'code' && b.info.lib && b.body !== code)
    .map((b) => ({ code: b.body, ts: isTsLang(b.info.lang) }))
}
/**
 * The note's runnable blocks as they went (`runs` in code — for a report): by name (or _kind<line>), its kind,
 * state ('ok' | 'error' | 'run' | 'none' — not run yet), time, error, a request's status, a query's rows, a
 * Playwright block's steps. Not the block asking.
 */
export function runsSnapshot(path: string, noteText: string, self: string): Record<string, unknown> {
  const n = noteRun(path)
  const out: Record<string, unknown> = {}
  for (const b of fencedBlocksOf(noteText)) {
    if (!isRunnableKind(b.kind) || b.info.lib || b.key === self) continue
    const r = toRaw(n.runs[b.key])
    out[b.key] = {
      kind: b.kind,
      state: r?.state ?? 'none',
      ...(r?.at ? { at: r.at } : {}),
      ...(r?.ms !== undefined ? { ms: Math.round(r.ms) } : {}),
      ...(r?.error ? { error: r.error.split('\n')[0] } : {}),
      ...(r?.response ? { status: r.response.status } : {}),
      ...(r?.table ? { rows: r.table.rows.length } : {}),
      ...(r?.steps ? { steps: r.steps.map((s) => ({ name: s.name, state: s.state, ms: s.ms })) } : {}),
      ...(b.info.soft ? { soft: true } : {}),
    }
  }
  return JSON.parse(JSON.stringify(out))
}
