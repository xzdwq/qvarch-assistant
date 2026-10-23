/**
 * `gen` — test values made on the spot (in Playwright scenarios and in the field matrix): a string of a length,
 * a uuid, an e-mail, a number in a range, a date some days off, a value by a pattern, a JSON object… Each call — a
 * new value.
 */
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]
const ALPHABETS: Record<string, string> = {
  ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  en: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  mixed: 'абвгдежзиклмнопрстуфхцчшэюяabcdefghijklmnopqrstuvwxyz0123456789',
  digits: '0123456789',
  hex: '0123456789abcdef',
}
const WORDS = ['тест', 'данные', 'проверка', 'значение', 'поле', 'запись', 'пример', 'строка', 'объект', 'список', 'новый', 'основной', 'test', 'sample', 'value']
const two = (n: number) => String(n).padStart(2, '0')

export const gen = {
  /** A string of exactly `n` characters: alphabet 'ru' | 'en' | 'mixed' | 'digits' | 'hex' or your own characters. */
  text(n = 10, alphabet = 'ru'): string {
    const chars = ALPHABETS[alphabet] ?? (alphabet || ALPHABETS.ru)
    let s = ''
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return s
  },
  /** `n` words with spaces. */
  words(n = 3): string {
    return Array.from({ length: n }, () => pick(WORDS)).join(' ')
  },
  /** `n` digits (the first one not 0). */
  digits(n = 6): string {
    return n <= 0 ? '' : String(1 + Math.floor(Math.random() * 9)) + gen.text(n - 1, 'digits')
  },
  /** n spaces. */
  spaces(n = 3): string {
    return ' '.repeat(n)
  },
  /** A text repeated (to a length: `repeat('ab', 5)` → 'ababa'). */
  repeat(s: string, length: number): string {
    return s ? s.repeat(Math.ceil(length / s.length)).slice(0, length) : ''
  },
  uuid(): string {
    const c = globalThis.crypto as Crypto | undefined
    if (c?.randomUUID) return c.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16)
      return (ch === 'x' ? r : (r & 3) | 8).toString(16)
    })
  },
  /** test.k3x9q@example.com */
  email(domain = 'example.com'): string {
    return `test.${gen.text(6, 'hex')}@${domain}`
  },
  /** By a pattern: # — a digit, A — a capital letter, a — a small one, * — a letter or a digit; the rest as is. */
  pattern(fmt: string): string {
    return fmt.replace(/[#Aa*]/g, (c) => (c === '#' ? gen.text(1, 'digits') : c === 'A' ? gen.text(1, 'en').toUpperCase() : c === 'a' ? gen.text(1, 'en').toLowerCase() : gen.text(1, 'mixed')))
  },
  phone(fmt = '+7 (9##) ###-##-##'): string {
    return gen.pattern(fmt)
  },
  /** A whole number min..max (both in). */
  int(min = 0, max = 1000): string {
    return String(Math.floor(min + Math.random() * (max - min + 1)))
  },
  /** A fractional number min..max with `digits` after the point; `comma` — written with a comma. */
  number(min = 0, max = 1000, digits = 2, comma = false): string {
    const s = (min + Math.random() * (max - min)).toFixed(digits)
    return comma ? s.replace('.', ',') : s
  },
  /** Today ± days, as `format`: dd, MM, yyyy, HH, mm, ss (default dd.MM.yyyy); 'iso' — ISO 8601. */
  date(days = 0, format = 'dd.MM.yyyy'): string {
    const d = new Date(Date.now() + days * 86_400_000)
    if (format === 'iso') return d.toISOString()
    return format
      .replace('yyyy', String(d.getFullYear()))
      .replace('MM', two(d.getMonth() + 1))
      .replace('dd', two(d.getDate()))
      .replace('HH', two(d.getHours()))
      .replace('mm', two(d.getMinutes()))
      .replace('ss', two(d.getSeconds()))
  },
  /** A value not met before: prefix-<time><random> (a name that must be unique). */
  unique(prefix = 'test'): string {
    return `${prefix}-${Date.now().toString(36)}${gen.text(3, 'hex')}`
  },
  /** One of the values given. */
  oneOf<T>(...xs: T[]): T {
    return pick(xs)
  },
  bool(): string {
    return pick(['true', 'false'])
  },
  /** An object / an array as JSON text (what a field takes). */
  json(v: unknown): string {
    return JSON.stringify(v)
  },
}
export type Gen = typeof gen

/** The generators a person picks from (the matrix's editor): what they make, their parameters, an example call. */
export interface GenKind {
  id: string
  title: string
  /** The parameters: their names and kinds (a text one written quoted). */
  params: Array<{ name: string; kind: 'num' | 'text' | 'json' | 'choice'; def: string; choices?: Array<[string, string]> }>
  /** The call (no parameters — a literal). */
  call?: keyof Gen
}
export const GEN_KINDS: GenKind[] = [
  { id: 'value', title: 'Своё значение', params: [{ name: 'значение', kind: 'text', def: '' }] },
  { id: 'empty', title: 'Пусто', params: [] },
  { id: 'spaces', title: 'Пробелы', call: 'spaces', params: [{ name: 'сколько', kind: 'num', def: '3' }] },
  {
    id: 'text',
    title: 'Строка длины N',
    call: 'text',
    params: [
      { name: 'длина', kind: 'num', def: '255' },
      { name: 'буквы', kind: 'choice', def: 'ru', choices: [['ru', 'русские'], ['en', 'латиница'], ['mixed', 'смесь с цифрами'], ['digits', 'цифры'], ['hex', '0-9 a-f']] },
    ],
  },
  { id: 'words', title: 'Слова', call: 'words', params: [{ name: 'сколько', kind: 'num', def: '3' }] },
  { id: 'digits', title: 'Цифры', call: 'digits', params: [{ name: 'сколько', kind: 'num', def: '10' }] },
  { id: 'int', title: 'Целое число', call: 'int', params: [{ name: 'от', kind: 'num', def: '1' }, { name: 'до', kind: 'num', def: '100' }] },
  {
    id: 'number',
    title: 'Дробное число',
    call: 'number',
    params: [
      { name: 'от', kind: 'num', def: '0' },
      { name: 'до', kind: 'num', def: '100' },
      { name: 'знаков', kind: 'num', def: '2' },
      { name: 'запятая', kind: 'choice', def: 'false', choices: [['false', 'точка'], ['true', 'запятая']] },
    ],
  },
  { id: 'uuid', title: 'UUID', call: 'uuid', params: [] },
  { id: 'email', title: 'E-mail', call: 'email', params: [{ name: 'домен', kind: 'text', def: 'example.com' }] },
  { id: 'phone', title: 'Телефон', call: 'phone', params: [{ name: 'шаблон', kind: 'text', def: '+7 (9##) ###-##-##' }] },
  { id: 'pattern', title: 'По шаблону', call: 'pattern', params: [{ name: 'шаблон (# цифра, A / a буква, * любой)', kind: 'text', def: 'AA-####' }] },
  {
    id: 'date',
    title: 'Дата',
    call: 'date',
    params: [
      { name: 'дней от сегодня', kind: 'num', def: '0' },
      { name: 'формат', kind: 'text', def: 'dd.MM.yyyy' },
    ],
  },
  { id: 'unique', title: 'Уникальная строка', call: 'unique', params: [{ name: 'начало', kind: 'text', def: 'test' }] },
  { id: 'json', title: 'JSON-объект', call: 'json', params: [{ name: 'объект', kind: 'json', def: '{ "id": 1, "name": "test" }' }] },
  { id: 'code', title: 'Выражение JS', params: [{ name: 'код', kind: 'text', def: "gen.text(10) + '!'" }] },
]

// ---------- a value's expression ↔ the generator picked ----------
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
/** A quoted literal ('…', "…", `…` without ${}) → its text; else undefined. */
export function unquote(lit: string): string | undefined {
  const m = /^(['"`])([\s\S]*)\1$/.exec(lit.trim())
  if (!m || (m[1] === '`' && m[2].includes('${'))) return undefined
  return m[2].replace(/\\(n|t|\\|'|"|`)/g, (_a, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}
/** The arguments of a call, split at the top-level commas (strings, brackets kept whole). */
function splitArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += s[++i] ?? ''
      else if (c === quote) quote = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
/** The generator and its parameters' texts of an expression (one not made by the editor — «Выражение JS»). */
export function exprToGen(expr: string): { id: string; args: string[] } {
  const e = expr.trim()
  const lit = unquote(e)
  if (lit !== undefined) return lit === '' ? { id: 'empty', args: [] } : { id: 'value', args: [lit] }
  const m = /^gen\.(\w+)\(([\s\S]*)\)$/.exec(e)
  const k = m && GEN_KINDS.find((g) => g.call === m[1])
  if (m && k) {
    const raw = splitArgs(m[2])
    // a call the editor can show: every argument a number / a string / (json) anything
    const args = k.params.map((p, i) => {
      const a = raw[i]
      if (a === undefined) return p.def
      if (p.kind === 'json') return a
      return unquote(a) ?? a
    })
    if (raw.length <= k.params.length) return { id: k.id, args }
  }
  return { id: 'code', args: [e] }
}
/** The expression of a generator picked with its parameters. */
export function genToExpr(id: string, args: string[]): string {
  const k = GEN_KINDS.find((g) => g.id === id)
  if (!k || id === 'code') return args[0]?.trim() || "''"
  if (id === 'value') return q(args[0] ?? '')
  if (id === 'empty') return "''"
  const lit = (p: GenKind['params'][number], a: string) => {
    if (p.kind === 'num') return String(Number(a) || 0)
    if (p.kind === 'json') return a.trim() || '{}'
    if (p.kind === 'choice' && (a === 'true' || a === 'false')) return a
    return q(a)
  }
  const parts = k.params.map((p, i) => lit(p, args[i] ?? p.def))
  // the trailing ones left as they are by default dropped: gen.text(255), not gen.text(255, 'ru')
  while (parts.length > 1 && parts[parts.length - 1] === lit(k.params[parts.length - 1], k.params[parts.length - 1].def)) parts.pop()
  return `gen.${k.call}(${parts.join(', ')})`
}
/** A label for a value made: «Строка 255 (латиница)», «UUID», «Дата −1 дн.». */
export function genLabel(id: string, args: string[]): string {
  const k = GEN_KINDS.find((g) => g.id === id)
  if (!k) return 'Значение'
  if (id === 'value') return `«${(args[0] ?? '').slice(0, 20)}»`
  if (id === 'text') return `Строка ${args[0] ?? 255}${args[1] && args[1] !== 'ru' ? ` (${k.params[1].choices!.find((c) => c[0] === args[1])?.[1] ?? args[1]})` : ''}`
  if (id === 'int' || id === 'number') return `${k.title} ${args[0] ?? ''}…${args[1] ?? ''}`
  if (id === 'date') return Number(args[0] ?? 0) ? `Дата ${Number(args[0]) > 0 ? '+' : '−'}${Math.abs(Number(args[0]))} дн.` : 'Дата сегодня'
  if (id === 'spaces' || id === 'words' || id === 'digits') return `${k.title}: ${args[0] ?? k.params[0].def}`
  return k.title
}
/** An expression's value now (the editor's example): the generators run here, an expression of code — not run. */
export function sampleOf(expr: string): string | undefined {
  const g = exprToGen(expr)
  if (g.id === 'code') return undefined
  if (g.id === 'value') return g.args[0]
  if (g.id === 'empty') return ''
  const k = GEN_KINDS.find((x) => x.id === g.id)!
  const args = k.params.map((p, i) => {
    const a = g.args[i] ?? p.def
    if (p.kind === 'num') return Number(a) || 0
    if (p.kind === 'json') {
      try {
        return JSON.parse(a) as unknown
      } catch {
        return a
      }
    }
    if (p.kind === 'choice' && (a === 'true' || a === 'false')) return a === 'true'
    return a
  })
  return (gen[k.call!] as (...a: unknown[]) => string)(...args)
}
