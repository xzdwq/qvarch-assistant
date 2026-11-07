/**
 * File transfers between the PC and an SSH server: a queue — a few at a time, each with its progress; a failed or
 * cancelled one does not stop the others. The state here is plain; main moves the bytes.
 */

export const TRANSFER_DIRS = ['up', 'down'] as const
export type TransferDir = (typeof TRANSFER_DIRS)[number]
export const TRANSFER_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type TransferState = (typeof TRANSFER_STATES)[number]
/** How many files go at once. */
export const TRANSFER_PARALLEL = 3

export interface Transfer {
  id: string
  sessionId: string
  dir: TransferDir
  /** Where from and where to (a local path, a remote one — by `dir`). */
  from: string
  to: string
  /** The file's name (shown). */
  name: string
  size: number
  done: number
  state: TransferState
  error?: string
  startedAt?: number
  endedAt?: number
}

const ENDED: ReadonlySet<TransferState> = new Set(['done', 'failed', 'cancelled'])
export const transferEnded = (t: Pick<Transfer, 'state'>) => ENDED.has(t.state)

/** The queued ones to start now: as many as there are free places, oldest first. */
export function transfersToStart(list: readonly Transfer[], parallel = TRANSFER_PARALLEL): Transfer[] {
  const free = parallel - list.filter((t) => t.state === 'running').length
  return free > 0 ? list.filter((t) => t.state === 'queued').slice(0, free) : []
}

/** A transfer's speed, bytes a second (none while it has not started or moved nothing). */
export function transferSpeed(t: Pick<Transfer, 'done' | 'startedAt' | 'endedAt'>, now = Date.now()): number {
  if (!t.startedAt || !t.done) return 0
  const s = ((t.endedAt ?? now) - t.startedAt) / 1000
  return s > 0 ? t.done / s : 0
}

/** The ended ones beyond the newest `keep` are forgotten (the list does not grow without end). */
export function trimEnded(list: readonly Transfer[], keep = 200): Transfer[] {
  const ended = list.filter(transferEnded)
  if (ended.length <= keep) return [...list]
  const drop = new Set(ended.slice(0, ended.length - keep).map((t) => t.id))
  return list.filter((t) => !drop.has(t.id))
}

/** A size for people: 0 Б, 1,5 КБ, 12 МБ, 3,4 ГБ. */
export function sizeText(n: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i && v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} ${units[i]}`
}

/** The temporary name a file is written under until it arrives whole. */
export const partName = (path: string) => `${path}.part`
