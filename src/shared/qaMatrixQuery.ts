import { foundIn } from './fuzz/verdict'
import type { MatrixCase, MatrixVerdict } from './qaMatrix'

/**
 * The field matrix of a field that saves nothing — a search, a filter: the value goes in a request (its address or
 * body) and comes back as what was found. Each value's outcome: the request's answer, how many were found (from the
 * answer itself — not the rows a page shows), what the page said, a step that failed.
 */
/** How a field of the matrix is judged: by its save (a form) or by its request (a search, a filter). */
export const MATRIX_MODES = ['save', 'query'] as const
export type MatrixMode = (typeof MATRIX_MODES)[number]
/** The matrix's closing line, its mode said in it (`}, { mode: 'query' }) // шаг: …`; none — found out by the run). */
const MATRIX_TAIL = /^(\s*)\}(?:, \{ mode: '(\w+)' \})?\)(\s*\/\/ шаг: Матрица значений полей.*)$/
/** The scenario with the matrix's mode said (none — taken off: found out by the run); no matrix — as it is. */
export function withMatrixMode(code: string, mode?: MatrixMode): string {
  const lines = code.split('\n')
  const at = lines.findIndex((l) => MATRIX_TAIL.test(l))
  if (at < 0) return code
  const m = MATRIX_TAIL.exec(lines[at])!
  lines[at] = `${m[1]}}${mode ? `, { mode: '${mode}' }` : ''})${m[3]}`
  return lines.join('\n')
}
/** A text's short fingerprint (FNV-1a, 32 bits — telling inputs apart, not guarding them). */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}
/**
 * What a value's outcome depends on besides the value itself: the scenario without its list of values (adding a
 * value changes nothing for the others; a step changed — everything is to run again).
 */
export function matrixScenarioSig(code: string): string {
  const lines = code.split('\n')
  const from = lines.findIndex((l) => /^\s*await\s+qa\.fieldMatrix\(\{\s*$/.test(l))
  const to = lines.findIndex((l, i) => i > from && /^\s*\}, async \(v\) => \{\s*$/.test(l))
  return fingerprint(from < 0 || to < 0 ? code : [...lines.slice(0, from), ...lines.slice(to)].join('\n'))
}
/** A value's key in the remembered outcomes (its field and the value itself, whole). */
export const valueKey = (field: string, value: string): string => fingerprint(`${field}\u0000${value}`)
/**
 * A value is to run anew though remembered: it is named for a recheck (by its label or its value as typed). The
 * names are the person's / the agent's — a recheck of what looks wrong, not a rule.
 */
export const asked = (recheck: readonly string[] | undefined, label: string, value: string): boolean => !!recheck?.some((r) => r === label || r === value)

export interface QueryObs {
  error?: string
  hints: string[]
  /** The request carrying the value (none — it did not go). */
  req?: { status?: number; res?: string; line: string }
}
export interface QueryVerdict extends MatrixVerdict {
  status?: number
  /** How many the answer says were found (none — it does not say). */
  found?: number
}

const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s)
function json(s?: string): unknown {
  try {
    return s ? (JSON.parse(s) as unknown) : undefined
  } catch {
    return undefined
  }
}

export function judgeQuery(c: MatrixCase, obs: QueryObs): QueryVerdict {
  const hint = obs.hints.join(' · ')
  const r = obs.req
  if (r?.status !== undefined && r.status >= 500) return { state: 'fail', result: `Ошибка сервера ${r.status}`, detail: short(r.res ?? r.line), status: r.status }
  if (r?.status !== undefined && r.status >= 400) return { state: hint ? 'ok' : 'warn', result: `Сервер отказал (${r.status})`, detail: hint ? `на странице: ${short(hint)}` : 'страница об этом не сказала', status: r.status }
  if (r?.status !== undefined && r.status >= 200 && r.status < 300) {
    const found = foundIn(json(r.res)).n
    const said = [found !== undefined ? `найдено ${found}` : 'сколько найдено — ответ не говорит', hint ? `на странице: ${short(hint, 100)}` : ''].filter(Boolean).join('; ')
    // (a value meant to be refused, answered as any other: worth a look)
    return { state: c.bad ? 'warn' : 'ok', result: `Ответ ${r.status}`, detail: c.bad ? `значение не отклонено; ${said}` : said, status: r.status, ...(found !== undefined ? { found } : {}) }
  }
  if (r && r.status === undefined) return { state: 'fail', result: 'Нет ответа', detail: `запрос ушёл, ответа нет (зависание / обрыв): ${r.line}` }
  if (obs.error) return { state: 'fail', result: 'Сценарий не прошёл', detail: `шаг не выполнился: ${short(obs.error.split('\n')[0])}` }
  if (hint) return { state: 'ok', result: 'Страница не пустила', detail: short(hint) }
  return { state: 'warn', result: 'Запрос не ушёл', detail: 'запроса с этим значением не было, страница ничего не сказала' }
}
