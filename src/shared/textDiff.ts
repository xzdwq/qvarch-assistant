import { diffArrays, diffWordsWithSpace } from 'diff'

/**
 * Two texts compared the way git does it (Myers' shortest edit script over lines): a line put in or taken out
 * moves nothing else — only real changes are marked. Lines changed in place are paired and the changed words
 * inside them lit. JSON is formatted first (keys sorted if asked), so its layout never counts as a change.
 */
/** auto — JSON when both sides parse; json — must be JSON; text — as is. */
export const DIFF_MODES = ['auto', 'json', 'text'] as const
export type DiffMode = (typeof DIFF_MODES)[number]
export interface DiffOptions {
  mode: DiffMode
  /** Spaces at the line ends / their count inside a line do not count. */
  ignoreSpace: boolean
  /** Letter case does not count. */
  ignoreCase: boolean
  /** JSON: the keys of objects sorted (their order does not count). */
  sortKeys: boolean
}
export const DEFAULT_DIFF: DiffOptions = { mode: 'auto', ignoreSpace: false, ignoreCase: false, sortKeys: true }

export interface Seg {
  t: string
  /** Lit: this part is what changed in the line. */
  hl?: boolean
}
export interface Side {
  /** The line's number on its side. */
  n: number
  segs: Seg[]
}
/** A row of the comparison: the same on both sides, taken out, put in, changed in place. */
export const ROW_KINDS = ['same', 'del', 'add', 'mod'] as const
export type RowKind = (typeof ROW_KINDS)[number]
export interface Row {
  kind: RowKind
  l?: Side
  r?: Side
}
export interface DiffResult {
  /** The texts compared (JSON formatted). */
  left: string
  right: string
  json: boolean
  /** JSON that would not parse (mode json), per side. */
  error?: { left?: string; right?: string }
  rows: Row[]
  stats: { added: number; removed: number; changed: number; same: boolean }
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort((a, b) => a.localeCompare(b)).map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]))
  return v
}
function parse(s: string): { ok: true; v: unknown } | { ok: false; e: string } {
  if (!s.trim()) return { ok: false, e: 'пусто' }
  try {
    return { ok: true, v: JSON.parse(s) }
  } catch (e) {
    return { ok: false, e: e instanceof Error ? e.message : String(e) }
  }
}
/** A text as JSON pretty-printed (keys sorted if asked), or as it was. */
export function formatJson(s: string, sortKeys: boolean): string | undefined {
  const p = parse(s)
  return p.ok ? JSON.stringify(sortKeys ? sortDeep(p.v) : p.v, null, 2) : undefined
}

const norm = (line: string, o: DiffOptions) => {
  let x = line
  if (o.ignoreSpace) x = x.trim().replace(/\s+/g, ' ')
  if (o.ignoreCase) x = x.toLowerCase()
  return x
}
/** The changed words of a line pair lit (the rest of the line plain). */
function words(a: string, b: string, o: DiffOptions): [Seg[], Seg[]] {
  const l: Seg[] = []
  const r: Seg[] = []
  for (const part of diffWordsWithSpace(a, b, { ignoreCase: o.ignoreCase })) {
    if (part.added) r.push({ t: part.value, hl: true })
    else if (part.removed) l.push({ t: part.value, hl: true })
    else {
      l.push({ t: part.value })
      r.push({ t: part.value })
    }
  }
  return [l, r]
}

export function compareTexts(left0: string, right0: string, o: DiffOptions = DEFAULT_DIFF): DiffResult {
  let left = left0.replace(/\r\n?/g, '\n')
  let right = right0.replace(/\r\n?/g, '\n')
  let json = false
  const error: DiffResult['error'] = {}
  if (o.mode !== 'text') {
    const a = parse(left)
    const b = parse(right)
    if (a.ok && b.ok) {
      json = true
      left = JSON.stringify(o.sortKeys ? sortDeep(a.v) : a.v, null, 2)
      right = JSON.stringify(o.sortKeys ? sortDeep(b.v) : b.v, null, 2)
    } else if (o.mode === 'json') {
      if (!a.ok && left.trim()) error.left = a.e
      if (!b.ok && right.trim()) error.right = b.e
    }
  }
  const L = left.length ? left.split('\n') : []
  const R = right.length ? right.split('\n') : []
  // Myers over whole lines (compared after the normalising options)
  const parts = diffArrays(L, R, { comparator: (x: string, y: string) => norm(x, o) === norm(y, o) })
  const rows: Row[] = []
  let li = 0
  let ri = 0
  let added = 0
  let removed = 0
  let changed = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p.added && !p.removed) {
      for (let k = 0; k < p.count!; k++) rows.push({ kind: 'same', l: { n: li + 1, segs: [{ t: L[li++] }] }, r: { n: ri + 1, segs: [{ t: R[ri++] }] } })
      continue
    }
    // a removed block followed by an added one: the lines changed in place, paired; the rest stand alone
    const del = p.removed ? p : undefined
    const add = p.removed && parts[i + 1]?.added ? parts[++i] : p.added ? p : undefined
    const dn = del?.count ?? 0
    const an = add?.count ?? 0
    const pairs = Math.min(dn, an)
    for (let k = 0; k < Math.max(dn, an); k++) {
      if (k < pairs) {
        const [ls, rs] = words(L[li], R[ri], o)
        rows.push({ kind: 'mod', l: { n: li + 1, segs: ls }, r: { n: ri + 1, segs: rs } })
        li++
        ri++
        changed++
      } else if (k < dn) {
        rows.push({ kind: 'del', l: { n: li + 1, segs: [{ t: L[li++], hl: true }] } })
        removed++
      } else {
        rows.push({ kind: 'add', r: { n: ri + 1, segs: [{ t: R[ri++], hl: true }] } })
        added++
      }
    }
  }
  return { left, right, json, error: error.left || error.right ? error : undefined, rows, stats: { added, removed, changed, same: !added && !removed && !changed } }
}

/** Long stretches of unchanged lines folded (a few kept around each change). */
export type View = { row: Row; i: number } | { fold: number; from: number; to: number }
export function foldRows(rows: Row[], ctx = 3, open: Set<number> = new Set()): View[] {
  const near = rows.map(() => false)
  rows.forEach((r, i) => {
    if (r.kind === 'same') return
    for (let k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) near[k] = true
  })
  const out: View[] = []
  for (let i = 0; i < rows.length; ) {
    if (near[i] || rows[i].kind !== 'same' || open.has(i)) {
      out.push({ row: rows[i], i })
      i++
      continue
    }
    let j = i
    while (j < rows.length && !near[j] && rows[j].kind === 'same' && !open.has(j)) j++
    // a short stretch is shown as it is
    if (j - i <= 2) for (let k = i; k < j; k++) out.push({ row: rows[k], i: k })
    else out.push({ fold: j - i, from: i, to: j })
    i = j
  }
  return out
}
