import { diffChars } from 'diff'

/** One replace that turns a text into another: what differs between their common start and their common end. */
export interface Splice {
  at: number
  /** Characters removed at `at`. */
  del: number
  ins: string
}

/** The smallest middle replace from `a` to `b` (null — they are the same). */
export function spliceOf(a: string, b: string): Splice | null {
  if (a === b) return null
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  return { at: s, del: a.length - s - e, ins: b.slice(s, b.length - e) }
}

/** A middle this long (on either side) is compared as one replace — comparing it closer would cost too much. */
const CLOSE_MAX = 50_000

/**
 * The replaces from `a` to `b`, each place apart (a change at two places is two replaces: the text between them stays
 * as it is — what is anchored there, and others' edits there, keep). Last place first: applied in this order, each
 * one's position is still the old text's.
 */
export function splicesOf(a: string, b: string): Splice[] {
  const one = spliceOf(a, b)
  if (!one) return []
  const mid = b.slice(one.at, one.at + one.ins.length)
  if (!one.del || !one.ins || one.del > CLOSE_MAX || mid.length > CLOSE_MAX) return [one]
  const out: Splice[] = []
  let at = one.at
  let cur: Splice | undefined
  for (const part of diffChars(a.slice(one.at, one.at + one.del), mid)) {
    if (!part.added && !part.removed) {
      if (cur) out.push(cur)
      cur = undefined
      at += part.value.length
      continue
    }
    cur ??= { at, del: 0, ins: '' }
    if (part.removed) {
      cur.del += part.value.length
      at += part.value.length
    } else cur.ins += part.value
  }
  if (cur) out.push(cur)
  return out.reverse()
}
