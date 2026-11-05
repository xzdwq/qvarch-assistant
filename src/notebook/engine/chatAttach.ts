import { ATTACH_MAX, attachBytes, type AttachKind, type ChatAttach, type FileKind } from '../../shared/transport/chat'
import type { BlockRun } from './runTypes'
import { scrubRun } from './sharedRuns'

/**
 * A block as a chat's message carries it: each kind — what of it goes (a query — its columns and rows, a request —
 * what was asked and answered, code — its whole block and its value, a browser test — its whole block as written).
 * Secrets taken off (the request's and answer's authorization, cookies, tokens); a table cut to fit, the rest counted.
 */
export interface SqlShot {
  columns: string[]
  rows: unknown[][]
  /** Rows the result had (more than shown — cut). */
  total: number
  more: boolean
  ms: number
  sql: string
}
export interface HttpShot {
  method: string
  url: string
  status: number
  statusText: string
  ms: number
  body: string
  /** The answer's body was longer (cut). */
  cut: boolean
}
export interface ValueShot {
  value: unknown
}
/** Code as it is written (its whole block — pasted into a note, it runs there) and, run already, its value. */
export interface CodeShot {
  source: string
  value?: unknown
  hasValue: boolean
}
/** A browser test as it is written: its whole block (pasted into a note — it runs there), not how it went. */
export interface PwShot {
  source: string
}

const BODY_MAX = 40_000
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** What a block gives to be sent: its last run (secrets taken off) and its text. */
export interface ShotFrom {
  run?: BlockRun
  src: string
}
/** The kinds a block is sent as (files go their own way; an agent's steps are not a block). */
export type ShotKind = Exclude<AttachKind, FileKind | 'trace'>
/** How an attachment is made to fit a message: as it is or not at all; or cut down (a table's rows). */
type Fit = (a: ChatAttach) => ChatAttach | undefined
const fitWhole: Fit = (a) => (attachBytes(a) <= ATTACH_MAX ? a : undefined)
/** A table too big: its rows halved until it fits. */
const fitRows: Fit = (a) => {
  const shot = a.data as SqlShot
  let rows = shot.rows
  while (rows.length && attachBytes({ ...a, data: { ...shot, rows } }) > ATTACH_MAX) rows = rows.slice(0, Math.floor(rows.length / 2))
  return { ...a, data: { ...shot, rows } }
}
/** Each kind: whether it needs a run done, its shot (none — nothing of that kind to send), how it fits a message. */
const SHOTS: Record<ShotKind, { needsRun: boolean; shot: (f: { run: BlockRun; src: string }) => unknown; fit: Fit }> = {
  sql: {
    needsRun: true,
    shot: ({ run: r }) => r.table && ({ columns: r.table.columns.map((c) => c.name), rows: r.table.rows, total: r.table.rows.length, more: r.table.more, ms: r.table.ms, sql: clip(r.sql?.text ?? '', 4000) } satisfies SqlShot),
    fit: fitRows,
  },
  http: {
    needsRun: true,
    shot: ({ run: r }) =>
      r.request &&
      r.response && { method: r.request.method, url: r.request.url, status: r.response.status, statusText: r.response.statusText, ms: r.response.time, body: clip(r.response.body, BODY_MAX), cut: r.response.body.length > BODY_MAX } satisfies HttpShot,
    fit: fitWhole,
  },
  code: { needsRun: false, shot: ({ run: r, src }) => (src.trim() ? ({ source: src, hasValue: !!r.hasValue, ...(r.hasValue ? { value: r.value } : {}) } satisfies CodeShot) : undefined), fit: fitWhole },
  value: { needsRun: true, shot: ({ run: r }) => ({ value: r.value }) satisfies ValueShot, fit: fitWhole },
  pw: { needsRun: false, shot: ({ src }) => (src.trim() ? ({ source: src } satisfies PwShot) : undefined), fit: fitWhole },
}
/** A kind sent with no run done (what is written, not what came of it). */
export const sendsUnrun = (kind: ShotKind) => !SHOTS[kind].needsRun

/** A block as a message's attachment (fitting a message — a table's rows cut); nothing to send — none. */
export function attachOf(kind: ShotKind, from: ShotFrom, title: string): ChatAttach | undefined {
  const s = SHOTS[kind]
  if (s.needsRun && !from.run) return undefined
  const data = s.shot({ run: from.run ? scrubRun(from.run) : { state: 'ok', at: 0 }, src: from.src })
  if (data === undefined) return undefined
  return s.fit({ kind, title: clip(title, 200), data })
}
