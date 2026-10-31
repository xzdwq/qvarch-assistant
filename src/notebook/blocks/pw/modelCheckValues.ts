import { readFuzz, writeFuzz, type FuzzParam } from '../../../shared/fuzz/spec'
import { readMatrix, writeMatrix, type MxField } from '../../../shared/qaChecks'
import { withMatrixMode, type MatrixMode } from '../../../shared/qaMatrixQuery'
import { joinFence, splitFence } from '../../domain/fence'
import { fencedBlocksOf } from '../../domain/noteBlocks'

/**
 * The values a ready check of a scenario runs with — what «Значения матрицы» and «Параметры перебора» of the block
 * edit, given by the AI agent's tool the same way: written into the scenario's code where the check reads them.
 */

/** A value of the field matrix: a literal (`value`) or an expression (`expr`: `gen.text(255)`…); `bad` — to be refused. */
export interface MatrixValue {
  label: string
  value?: string
  expr?: string
  bad?: boolean
}
/** The matrix's values (`mode` — judged by the field's save or by its request: a search, a filter; none — found out). */
export type CheckValues = { kind: 'matrix'; fields: Record<string, MatrixValue[]>; mode?: MatrixMode } | { kind: 'fuzz'; request: string; found?: string; params: FuzzParam[] }

const ARRAY_MAX = 60
/** The matrix's fields with the values given (a field by its id `f1`, or by its name as in the code), its mode said. */
function matrixWith(code: string, given: Record<string, MatrixValue[]>, mode?: MatrixMode): { code: string } | { error: string } {
  const at = readMatrix(code)
  if (!at) return { error: 'В сценарии нет матрицы значений полей — сначала pw_check kind=matrix' }
  const fields: MxField[] = at.fields.map((f) => ({ ...f }))
  for (const [key, values] of Object.entries(given)) {
    const f = fields.find((x) => x.id === key || x.name === key)
    if (!f) return { error: `Поля «${key}» в матрице нет — есть: ${fields.map((x) => `${x.id} «${x.name}»`).join(', ')}` }
    if (!Array.isArray(values) || values.length > ARRAY_MAX) return { error: `Поле «${key}»: список значений до ${ARRAY_MAX}` }
    f.cases = values.map((v) => ({ label: String(v.label ?? '').trim() || String(v.value ?? v.expr ?? ''), expr: v.expr?.trim() || JSON.stringify(String(v.value ?? '')), bad: !!v.bad }))
  }
  const written = writeMatrix(code, fields)
  return { code: mode ? withMatrixMode(written, mode) : written }
}
/** The request to try and its parameters with their values. */
function fuzzWith(code: string, v: Extract<CheckValues, { kind: 'fuzz' }>): { code: string } | { error: string } {
  const at = readFuzz(code)
  if (!at) return { error: 'В сценарии нет перебора параметров запроса — сначала pw_check kind=fuzz' }
  if (!/^[A-Z]+\s+\/\S*$/.test(v.request?.trim() ?? '')) return { error: 'request — метод и путь запроса: «GET /api/items» (без адреса сайта и без параметров)' }
  const params = Array.isArray(v.params) ? v.params : []
  for (const p of params) {
    if (!p || typeof p.path !== 'string' || !p.path.trim()) return { error: 'У параметра нужен path: query.<имя> или body.<путь>' }
    if (!Array.isArray(p.cases) || !p.cases.length || p.cases.some((c) => typeof c?.value !== 'string')) return { error: `Параметр «${p.path}»: cases — список { label, value } (value — выражение: '""', 'null', 'drop', 'size(21)', 'gen.text(255)', '"-1"')` }
  }
  if (!params.length) return { error: 'Нужен хотя бы один параметр (params)' }
  return { code: writeFuzz(code, { ...at.spec, request: v.request.trim(), ...(v.found ? { found: v.found } : {}), params: params.map((p) => ({ path: p.path.trim(), cases: p.cases.slice(0, ARRAY_MAX).map((c) => ({ label: String(c.label ?? c.value), value: c.value })) })) }) }
}

/** A note's Playwright block (by its name) with its check's values given: the note's new text, or why not. */
export function checkValuesIn(text: string, name: string, v: CheckValues): { text: string } | { error: string } {
  const b = fencedBlocksOf(text).find((x) => x.kind === 'pw' && x.info.name === name)
  if (!b) return { error: `В заметке нет блока Playwright «${name}» (name=…)` }
  const parts = splitFence(b.src)
  const r = v.kind === 'matrix' ? matrixWith(parts.body, v.fields ?? {}, v.mode) : fuzzWith(parts.body, v)
  if ('error' in r) return r
  const lines = text.split('\n')
  lines.splice(b.line0 - 1, b.line1 - b.line0 + 1, ...joinFence(parts.fence, parts.info, r.code).split('\n'))
  return { text: lines.join('\n') }
}
