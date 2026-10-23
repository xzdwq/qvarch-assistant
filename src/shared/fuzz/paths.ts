/** A parameter's place in a request's tree: «body.filter.ids», «query.filter[ids]» — read, written, left out. */

/** «Leave the parameter out». */
export const DROP = Symbol.for('qa.fuzz.drop')

export type Seg = string | number
/** «body.filter.ids», «query.filter[ids]» — the segments; a key with dots / brackets as ["…"]. */
export function parsePath(p: string): Seg[] {
  const out: Seg[] = []
  const re = /\["((?:\\.|[^"\\])*)"\]|\[(\d+)\]|\[([^\]"]*)\]|\.?([^.[\]]+)/g
  // (each match is one of: ["quoted"], [0], [bare], .plain)
  for (const [, quoted, index, bare, plain] of p.matchAll(re)) {
    if (quoted !== undefined) out.push(quoted.replace(/\\(.)/g, '$1'))
    else out.push(index !== undefined ? Number(index) : (bare ?? plain))
  }
  return out
}
/** The segments written as a path (the reverse of parsePath). */
export function pathOf(segs: Seg[]): string {
  return segs
    .map((s, i) => (typeof s === 'number' ? `[${s}]` : /^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(s) ? (i ? `.${s}` : s) : `["${s.replace(/["\\]/g, '\\$&')}"]`))
    .join('')
}
/** The value at the path (and whether it is there at all). */
export function getPath(tree: unknown, segs: Seg[]): { has: boolean; value: unknown } {
  let v: unknown = tree
  for (const s of segs) {
    if (v === null || typeof v !== 'object' || !(s in (v as object))) return { has: false, value: undefined }
    v = (v as Record<string | number, unknown>)[s]
  }
  return { has: true, value: v }
}
/** The value set at the path (a copy of the tree; DROP — the key left out). */
export function setPath<T>(tree: T, segs: Seg[], value: unknown): T {
  const root = structuredClone(tree) as unknown
  if (!segs.length) return value as T
  let at = root as Record<string | number, unknown>
  for (const s of segs.slice(0, -1)) {
    if (at[s] === null || typeof at[s] !== 'object') at[s] = {}
    at = at[s] as Record<string | number, unknown>
  }
  const last = segs[segs.length - 1]
  if (value === DROP) {
    if (Array.isArray(at) && typeof last === 'number') at.splice(last, 1)
    else delete at[last]
  } else at[last] = value
  return root as T
}
