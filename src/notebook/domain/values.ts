/**
 * The note's context values: paths into them ({{ login.body.items[0].id }}), templates filled from them, and
 * values shown in a few words.
 */

/** Values by name (what templates, code and queries see). */
export type Values = Record<string, unknown>

/** An object's field; undefined for anything else. */
const fieldOf = (v: unknown, k: string): unknown => (v && typeof v === 'object' ? (v as Values)[k] : undefined)
/** The steps a path is made of, tried in order: how each one reads and what it takes from the value. */
const PATH_STEPS: ReadonlyArray<{ re: RegExp; take: (v: unknown, m: RegExpExecArray) => unknown }> = [
  // .key (.length of an array / a text too)
  { re: /^\.([A-Za-z_$][\w$]*)/, take: (v, m) => (m[1] === 'length' && (Array.isArray(v) || typeof v === 'string') ? v.length : fieldOf(v, m[1])) },
  // [0]
  { re: /^\[\s*(\d+)\s*\]/, take: (v, m) => (Array.isArray(v) ? v[Number(m[1])] : fieldOf(v, m[1])) },
  // ["key"] / ['key']
  { re: /^\[\s*(["'])(.*?)\1\s*\]/, take: (v, m) => fieldOf(v, m[2]) },
]
/** The path step at the start of `rest` (the first kind that reads there). */
function nextStep(rest: string): { hit: RegExpExecArray; take: (v: unknown, m: RegExpExecArray) => unknown } | undefined {
  for (const s of PATH_STEPS) {
    const hit = s.re.exec(rest)
    if (hit) return { hit, take: s.take }
  }
  return undefined
}

/** Follows a path into the values: login.body.items[0].id, items.length, h["content-type"]. */
export function resolvePath(ctx: Values, path: string): { ok: boolean; value?: unknown } {
  const p = path.trim()
  const m = /^([A-Za-z_$][\w$]*)/.exec(p)
  if (!m || !(m[1] in ctx)) return { ok: false }
  let v: unknown = ctx[m[1]]
  let rest = p.slice(m[1].length)
  while (rest) {
    const step = nextStep(rest)
    if (!step) return { ok: false }
    v = step.take(v, step.hit)
    rest = rest.slice(step.hit[0].length)
  }
  return { ok: true, value: v }
}

/** A {{ path }} placeholder in a text (global: reset lastIndex before exec loops). */
export const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Fills {{ path }} with the values (objects as JSON); unknown paths stay as they are and are listed. */
export function interpolate(text: string, ctx: Values): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = text.replace(TEMPLATE, (all, path: string) => {
    const r = resolvePath(ctx, path)
    if (!r.ok) {
      missing.push(path)
      return all
    }
    return r.value === undefined || r.value === null ? '' : typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)
  })
  return { text: out, missing }
}

/** The error text of placeholders without a value (a block that gives them has not run yet). */
export const missingValuesError = (missing: string[]) => `Нет значения: ${[...new Set(missing)].map((m) => `{{${m}}}`).join(', ')} — выполните блок, который его даёт`

/** A value in a few words: «массив · 120», «объект · 8 ключей», a short text. */
export function summary(v: unknown): string {
  if (v === undefined) return 'нет значения'
  if (v === null) return 'null'
  if (Array.isArray(v)) return `массив · ${v.length}`
  if (typeof v === 'object') return `объект · ${Object.keys(v as object).length} ${plural(Object.keys(v as object).length, 'ключ', 'ключа', 'ключей')}`
  const s = String(v)
  return s.length > 60 ? `${s.slice(0, 60)}…` : s
}
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many)

/** A value on one line, cut at 120 characters (the {{ value }} chips in the text). */
export function inlineValue(v: unknown): string {
  const s = v === undefined || v === null ? String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}

/** A value as pretty JSON (for showing), cut when huge. */
export function prettyValue(v: unknown, max = 200_000): string {
  let s: string
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  } catch {
    s = String(v)
  }
  return s.length > max ? `${s.slice(0, max)}\n… (обрезано: ${Math.round(s.length / 1024)} КБ)` : s
}

/** A deep copy through JSON (what crosses to another process, what is kept in the runs file). */
export const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T
