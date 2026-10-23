import { apiPath } from '../apiMap'

/** The check's spec (its argument, JSON in the scenario's code) and its line in the code. */

export interface FuzzCase {
  label: string
  /** An expression: a literal, `null`, `drop` (the parameter left out), `size(21)` (an array of 21), `gen.text(255)`… */
  value: string
}
export interface FuzzParam {
  /** Where: `body.filter.ids`, `query.filter[ids]`…, see pathOf. */
  path: string
  cases: FuzzCase[]
  /** More values — not fewer found (a filter's list of values: «одно из»). */
  monotonic?: boolean
}
export interface FuzzSpec {
  /** The request: «POST /api/items/search» (ids in the path as :id). */
  request: string
  /** Its example (the API map's) — when the scenario did not send it itself. */
  sample?: { url: string; body?: string; contentType?: string }
  /** Where «how many found» is in the answer (`meta.total`, `data`…); none — guessed. */
  found?: string
  /** An answer slower than this (ms) is marked; by default 3 s or 5× the original's time. */
  slowMs?: number
  params: FuzzParam[]
}

/** The endpoint a request is («POST /api/items/:id»). */
export const endpointKey = (method: string, url: string) => `${method.toUpperCase()} ${apiPath(url).path}`
const HEAD = /^\s*await\s+qa\.fuzz\(\s*$/
const TAIL = /^\s*\)\s*(\/\/.*)?$/
/** The check's spec in the code (its lines, its JSON). */
export function readFuzz(code: string): { from: number; to: number; spec: FuzzSpec } | undefined {
  const lines = code.split('\n')
  const from = lines.findIndex((l) => HEAD.test(l))
  if (from < 0) return undefined
  const to = lines.findIndex((l, i) => i > from && TAIL.test(l))
  if (to < 0) return undefined
  try {
    const spec = JSON.parse(lines.slice(from + 1, to).join('\n')) as FuzzSpec
    return { from, to, spec: { ...spec, params: Array.isArray(spec.params) ? spec.params : [] } }
  } catch {
    return undefined
  }
}
/** The code with the check's spec written over the old one (no check in it — the code as it is). */
export function writeFuzz(code: string, spec: FuzzSpec): string {
  const at = readFuzz(code)
  const json = JSON.stringify(spec, null, 2).split('\n')
  if (!at) return code
  const lines = code.split('\n')
  return [...lines.slice(0, at.from + 1), ...json, ...lines.slice(at.to)].join('\n')
}
export const FUZZ_COMMENT = '// шаг: Перебор параметров запроса'
export const emptyFuzz = (): FuzzSpec => ({ request: '', params: [] })
export const fuzzLines = (spec: FuzzSpec) => ['await qa.fuzz(', ...JSON.stringify(spec, null, 2).split('\n'), `) ${FUZZ_COMMENT}`]
