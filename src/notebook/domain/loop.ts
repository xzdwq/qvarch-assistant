/**
 * A loop of a note: the blocks between its start and its end run once per pass, the pass made by plain JS — the
 * loop's head calls `body({ … })` for each pass, the values given becoming the blocks' variables:
 *
 *   <!-- qa:loop name=answers parallel=4 -->
 *   ```js loop
 *   for (const [i, u] of users.entries()) await body({ i, u })
 *   ```
 *   ```http name=user
 *   GET https://site/api/users/{{u.id}}
 *   ```
 *   <!-- /qa:loop -->
 *
 * The start and the end are comments: in other Markdown viewers the note is its blocks as they are. Loops nest.
 */
import { isName } from './blockInfo'
import { FENCE_OPEN, findFenceClose } from './fence'

export const LOOP_OPEN = /^<!--\s*qa:loop\b(.*?)-->\s*$/
export const LOOP_CLOSE = /^<!--\s*\/qa:loop\s*-->\s*$/

export interface LoopInfo {
  /** Its result's name (the passes' records, or what the head returns). */
  name?: string
  /** Passes at once (1 — one after another). */
  parallel: number
  /** Passes at most: one more is an error (a `while` that never ends stops here). */
  max: number
  /** Seconds the whole loop may run. */
  timeout: number
  /** Its error does not stop «Выполнить всё». */
  soft?: boolean
}
export const LOOP_MAX = 1000
export const LOOP_MAX_LIMIT = 100_000
export const LOOP_TIMEOUT = 600
export const LOOP_PARALLEL_LIMIT = 16

/** A positive whole number of an attribute, capped; undefined — not one. */
const countUpTo = (limit: number, v: string): number | undefined => {
  const n = Math.floor(Number(v))
  return n >= 1 ? Math.min(limit, n) : undefined
}
/** The `key=value` attributes of a loop's start, each writing its field when the value fits it. */
const LOOP_SETTINGS: Record<string, (out: LoopInfo, v: string) => void> = {
  name: (out, v) => {
    if (isName(v)) out.name = v
  },
  parallel: (out, v) => {
    out.parallel = countUpTo(LOOP_PARALLEL_LIMIT, v) ?? out.parallel
  },
  max: (out, v) => {
    out.max = countUpTo(LOOP_MAX_LIMIT, v) ?? out.max
  },
  timeout: (out, v) => {
    out.timeout = countUpTo(86_400, v) ?? out.timeout
  },
}

/** Parses the attributes of a loop's start comment (name=, parallel=, max=, timeout=, soft). */
export function parseLoopInfo(attrs: string): LoopInfo {
  const out: LoopInfo = { parallel: 1, max: LOOP_MAX, timeout: LOOP_TIMEOUT }
  for (const p of attrs.trim().split(/\s+/).filter(Boolean)) {
    const m = /^([\w-]+)=(.*)$/.exec(p)
    if (!m) {
      if (p === 'soft') out.soft = true
      continue
    }
    if (Object.hasOwn(LOOP_SETTINGS, m[1])) LOOP_SETTINGS[m[1]](out, m[2])
  }
  return out
}
/** Writes a loop's start comment (defaults left out). */
export function loopOpenMd(i: LoopInfo): string {
  const a = [i.name ? `name=${i.name}` : '', i.parallel > 1 ? `parallel=${i.parallel}` : '', i.max !== LOOP_MAX ? `max=${i.max}` : '', i.timeout !== LOOP_TIMEOUT ? `timeout=${i.timeout}` : '', i.soft ? 'soft' : ''].filter(Boolean)
  return `<!-- qa:loop${a.length ? ` ${a.join(' ')}` : ''} -->`
}
export const LOOP_CLOSE_MD = '<!-- /qa:loop -->'

/** A loop's start: its comment line, the head fence right under it (```js loop) — or the comment alone. */
export function loopStartAt(lines: readonly string[], i: number): { line1: number; info: LoopInfo; head: string; ts: boolean } | undefined {
  const m = LOOP_OPEN.exec(lines[i] ?? '')
  if (!m) return undefined
  const info = parseLoopInfo(m[1])
  const f = FENCE_OPEN.exec(lines[i + 1] ?? '')
  if (f && /^(js|javascript|ts|typescript)$/i.test(f[2]) && /(^|\s)loop(\s|$)/.test(f[3])) {
    const j = findFenceClose(lines, i + 2, f[1])
    if (j < lines.length) return { line1: j + 1, info, head: lines.slice(i + 2, j).join('\n'), ts: /^t/i.test(f[2]) }
  }
  return { line1: i + 1, info, head: '', ts: false }
}

export interface LoopRange {
  /** Its run's key: its name, or its place. */
  key: string
  info: LoopInfo
  head: string
  ts: boolean
  /** The start's first line, the head's last one, the end's line (1-based); no end — `end` undefined. */
  line0: number
  headEnd: number
  end?: number
  depth: number
  /** The loop around it (its key). */
  parent?: string
}
/** The key a loop's run is kept under: its name, or its place (an unnamed one). */
export const loopKey = (name: string | undefined, line0: number) => name || `_loop${line0}`

/** The note's loops, outer first (lines inside other code fences are not looked at; an end with no start — ignored). */
export function findLoops(lines: readonly string[]): LoopRange[] {
  const out: LoopRange[] = []
  const stack: LoopRange[] = []
  let i = 0
  while (i < lines.length) {
    const st = loopStartAt(lines, i)
    if (st) {
      const r: LoopRange = { key: loopKey(st.info.name, i + 1), info: st.info, head: st.head, ts: st.ts, line0: i + 1, headEnd: st.line1, depth: stack.length, parent: stack[stack.length - 1]?.key }
      out.push(r)
      stack.push(r)
      i = st.line1
      continue
    }
    if (LOOP_CLOSE.test(lines[i])) {
      const r = stack.pop()
      if (r) r.end = i + 1
      i++
      continue
    }
    const f = FENCE_OPEN.exec(lines[i])
    if (f) {
      i = findFenceClose(lines, i + 1, f[1]) + 1
      continue
    }
    i++
  }
  return out
}
/** The innermost loop a line is in (its body: after the head, before the end). */
export function loopAt(loops: readonly LoopRange[], line: number): LoopRange | undefined {
  let best: LoopRange | undefined
  for (const l of loops) if (l.end !== undefined && line > l.headEnd && line < l.end && (!best || l.depth > best.depth)) best = l
  return best
}
/** How many (closed) loops each line is in — from a loop's start to its end (index: 1-based line). */
export function loopDepths(loops: readonly LoopRange[], lineCount: number): Uint8Array {
  const d = new Uint8Array(lineCount + 2)
  for (const l of loops) if (l.end !== undefined) for (let i = l.line0; i <= l.end; i++) d[i] = Math.min(255, d[i] + 1)
  return d
}
/** The key is taken twice (two loops, two blocks of one name): the second one's name said. */
export function duplicateKeys(keys: string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const k of keys) (seen.has(k) ? dup : seen).add(k)
  return [...dup]
}

/**
 * The names a head's code gives to `body({ … })` — for the hints of the blocks inside (what they may use). Only
 * the plain cases (`body({ i, u })`, `body({ id: x.id })`); the rest is known when the loop runs.
 */
export function bodyVars(head: string): string[] {
  const out = new Set<string>()
  for (const m of head.matchAll(/\bbody\s*\(\s*\{([^{}]*)\}/g))
    for (const part of m[1].split(',')) {
      const k = /^\s*([A-Za-z_$][\w$]*)/.exec(part)?.[1]
      if (k) out.add(k)
    }
  return [...out]
}

// ---------- a loop's run (its head in a process of its own; the passes in the app) ----------
export interface LoopJob {
  head: string
  ts: boolean
  libs: Array<{ code: string; ts: boolean }>
  ctx: Record<string, unknown>
  parallel: number
  max: number
}
/** A pass as the app ran it: the values its blocks published (by name), or what went wrong. */
export type PassResult = { ok: true; values: Record<string, unknown> } | { ok: false; error: string }
export interface LoopResult {
  ok: boolean
  /** What the head returned (none — the loop's result is its passes' records). */
  value?: unknown
  hasValue?: boolean
  sets?: Record<string, unknown>
  logs: Array<{ level: 'log' | 'info' | 'warn' | 'error'; text: string }>
  error?: string
  /** The passes asked for. */
  passes: number
  ms: number
}
