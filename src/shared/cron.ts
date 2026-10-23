import cronstrue from 'cronstrue/i18n'
import { CronExpressionParser } from 'cron-parser'

/**
 * Cron expressions: what one means in Russian (cronstrue) and when it runs next (cron-parser), for the three
 * usual dialects — Unix crontab (5 fields), Spring @Scheduled (6: seconds first) and Quartz (6–7: seconds,
 * `?` for "no specific day", days of week 1–7 from Sunday, an optional year).
 */
export type CronFormat = 'crontab' | 'spring' | 'quartz'

/** One place of an expression: its name and the values it takes (the window's legend). */
export interface CronField {
  name: string
  values: string
}

/** One dialect: how it is shown, its fields, and how it is read / moved to and from the crontab one. */
export interface CronDialect {
  title: string
  hint: string
  /** The numbers of fields it takes. */
  fieldCounts: readonly number[]
  /** It has a seconds field (first). */
  seconds: boolean
  /** It takes `?` (no specific day). */
  noSpecificDay: boolean
  /** Days of week counted from 0 = Sunday (else 1 = Sunday). */
  dayOfWeekFromZero: boolean
  /** The index of its year field, if it has one. */
  yearField?: number
  fields: readonly CronField[]
  placeholder: string
  /** Its fields (their count checked) as cron-parser reads them: 5, or 6 with seconds first; throws with what is wrong. */
  toParser: (f: string[]) => string
  /** Its fields → the 5 crontab ones. */
  toCrontab: (f: string[]) => string[]
  /** A crontab expression → this dialect (seconds 0). */
  fromCrontab: (expr: string) => string
}

const fieldsOf = (e: string) => e.trim().split(/\s+/).filter(Boolean)

/** Quartz's days of week (1 = Sunday … 7 = Saturday) as the usual ones (0 = Sunday … 6). */
function quartzDow(field: string): string {
  return field
    .split(',')
    .map((part) => {
      const [base, step] = part.split('/')
      const b = base.replace(/\d+/g, (d, off: number) => (base[off - 1] === '#' ? d : String(Math.max(0, Number(d) - 1))))
      return step === undefined ? b : `${b}/${step}`
    })
    .join(',')
}

/** The fields of minutes … day of week; `dom` / `dow` — what the dialect's days take. */
const dayFields = (dom: string, dow: string): CronField[] => [
  { name: 'минута', values: '0–59' },
  { name: 'час', values: '0–23' },
  { name: 'день месяца', values: dom },
  { name: 'месяц', values: '1–12, JAN–DEC' },
  { name: 'день недели', values: dow },
]
const SECOND_FIELD: CronField = { name: 'секунда', values: '0–59' }
const DOM_WITH_W = '1–31, L, W, ?'
const DOW_FROM_ZERO = '0–7 (0, 7 = вс), SUN–SAT, L, #'

/** The dialects (the window's switch goes in this order). */
export const CRON_DIALECTS: Record<CronFormat, CronDialect> = {
  crontab: {
    title: 'Unix',
    hint: 'crontab, Kubernetes CronJob, GitHub Actions: минута час день месяц день-недели',
    fieldCounts: [5],
    seconds: false,
    noSpecificDay: false,
    dayOfWeekFromZero: true,
    fields: dayFields('1–31, L', DOW_FROM_ZERO),
    placeholder: '0 12 * * 1-6',
    toParser: (f) => {
      if (f.length !== 5) throw new Error(`В Unix-формате 5 полей (минута час день месяц день-недели), а здесь ${f.length}`)
      return f.join(' ')
    },
    toCrontab: (f) => f,
    fromCrontab: (expr) => expr,
  },
  spring: {
    title: 'Spring',
    hint: '@Scheduled(cron = …): секунда минута час день месяц день-недели (0–7, 0 и 7 — воскресенье)',
    fieldCounts: [6],
    seconds: true,
    noSpecificDay: true,
    dayOfWeekFromZero: true,
    fields: [SECOND_FIELD, ...dayFields(DOM_WITH_W, DOW_FROM_ZERO)],
    placeholder: '0 0 12 * * 1-6',
    toParser: (f) => {
      if (f.length !== 6) throw new Error(`В Spring 6 полей (секунда минута час день месяц день-недели), а здесь ${f.length}`)
      return f.join(' ')
    },
    toCrontab: (f) => f.slice(1, 6),
    fromCrontab: (expr) => {
      const [mi, h, dom, mon, dow] = fieldsOf(expr)
      return `0 ${mi} ${h} ${dom} ${mon} ${dow}`
    },
  },
  quartz: {
    title: 'Quartz',
    hint: 'Quartz, Jenkins-подобные планировщики: секунда … день-недели (1–7, 1 — воскресенье), ? — «не важно», [год]',
    fieldCounts: [6, 7],
    seconds: true,
    noSpecificDay: true,
    dayOfWeekFromZero: false,
    yearField: 6,
    fields: [SECOND_FIELD, ...dayFields(DOM_WITH_W, '1–7 (1 = вс), SUN–SAT, ?, L, #'), { name: 'год (необяз.)', values: '1970–2099' }],
    placeholder: '0 0 12 * * 1-6',
    toParser: (f) => {
      if (f.length !== 6 && f.length !== 7) throw new Error(`В Quartz 6 или 7 полей (секунда … день-недели [год]), а здесь ${f.length}`)
      if (f[3] !== '?' && f[5] !== '?') throw new Error('В Quartz день месяца или день недели должен быть «?» (не важно)')
      return [f[0], f[1], f[2], f[3], f[4], quartzDow(f[5])].join(' ')
    },
    toCrontab: (f) => [f[1], f[2], f[3] === '?' ? '*' : f[3], f[4], f[5] === '?' ? '*' : quartzDow(f[5])],
    fromCrontab: (expr) => {
      const [mi, h, dom, mon, dow] = fieldsOf(expr)
      const qDow = dow === '*' ? '?' : dow.split(',').map((p) => p.replace(/\d+/g, (d) => String((Number(d) % 7) + 1))).join(',')
      return `0 ${mi} ${h} ${dow === '*' ? dom : '?'} ${mon} ${qDow}`
    },
  },
}
export const CRON_FORMATS = (Object.keys(CRON_DIALECTS) as CronFormat[]).map((id) => ({ id, ...CRON_DIALECTS[id] }))

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

/** The dialect a pasted expression is most likely in. */
export function guessFormat(expr: string): CronFormat | undefined {
  const t = expr.trim()
  if (!t) return undefined
  if (t.startsWith('@')) return 'crontab'
  const f = fieldsOf(t)
  if (f.length === 5) return 'crontab'
  if (f.length === 7 || (f.length === 6 && (f.includes('?') || /^[1-7](?:[-,#L/]|$)/.test(f[5]) && /\?/.test(f[3])))) return 'quartz'
  if (f.length === 6) return f.includes('?') ? 'quartz' : 'spring'
  return undefined
}

/** Does an expression of `count` fields fit the dialect? */
export const fitsFormat = (count: number, format: CronFormat) => CRON_DIALECTS[format].fieldCounts.includes(count)

/** The expression as cron-parser reads it (5 fields, or 6 with seconds first). */
export function forParser(expr: string, format: CronFormat): string {
  const t = expr.trim()
  if (t.startsWith('@')) return MACROS[t.toLowerCase()] ?? t
  return CRON_DIALECTS[format].toParser(fieldsOf(t))
}

/** In words, Russian (throws on a broken expression). */
export function describeCron(expr: string, format: CronFormat): string {
  const t = expr.trim()
  const src = t.startsWith('@') ? (MACROS[t.toLowerCase()] ?? t) : t
  return cronstrue.toString(src, { locale: 'ru', use24HourTimeFormat: true, dayOfWeekStartIndexZero: CRON_DIALECTS[format].dayOfWeekFromZero, throwExceptionOnParseError: true, verbose: false })
}

/** The years a dialect's year field limits the runs to (none — not limited). */
function yearsOf(f: string[], format: CronFormat): Set<number> | undefined {
  const at = CRON_DIALECTS[format].yearField
  if (at === undefined || f.length <= at || f[at] === '*' || f[at] === '?') return undefined
  return yearSet(f[at])
}

/** The next runs (local time unless a time zone is given); a Quartz year limits them. */
export function nextRuns(expr: string, format: CronFormat, count = 10, from = new Date(), tz?: string): Date[] {
  const p = CronExpressionParser.parse(forParser(expr, format), { currentDate: from, ...(tz ? { tz } : {}) })
  const years = yearsOf(fieldsOf(expr), format)
  const out: Date[] = []
  for (let i = 0; out.length < count && i < count * 400; i++) {
    let d: Date
    try {
      d = p.next().toDate()
    } catch {
      break
    }
    if (years) {
      if (d.getFullYear() > Math.max(...years)) break
      if (!years.has(d.getFullYear())) continue
    }
    out.push(d)
  }
  return out
}
function yearSet(field: string): Set<number> {
  const s = new Set<number>()
  for (const part of field.split(',')) {
    const [range, step] = part.split('/')
    const [a, b] = range.split('-').map(Number)
    for (let y = a; y <= (b ?? (step ? a + 100 : a)); y += Number(step ?? 1)) s.add(y)
  }
  return s
}

/** Ready ones to start from (in the crontab dialect; the window converts them). */
export const CRON_PRESETS: Array<{ title: string; expr: string }> = [
  { title: 'Каждую минуту', expr: '* * * * *' },
  { title: 'Каждые 5 минут', expr: '*/5 * * * *' },
  { title: 'Каждые 15 минут', expr: '*/15 * * * *' },
  { title: 'Каждый час', expr: '0 * * * *' },
  { title: 'Каждый день в 00:00', expr: '0 0 * * *' },
  { title: 'Каждый день в 12:00, кроме воскресенья', expr: '0 12 * * 1-6' },
  { title: 'По будням в 9:00', expr: '0 9 * * 1-5' },
  { title: 'По выходным в 10:00', expr: '0 10 * * 0,6' },
  { title: 'Каждый понедельник в 8:30', expr: '30 8 * * 1' },
  { title: '1-го числа в 00:00', expr: '0 0 1 * *' },
  { title: 'Последний день месяца в 23:00', expr: '0 23 L * *' },
  { title: '1 января в 00:00', expr: '0 0 1 1 *' },
]
/** An expression moved into another dialect (seconds other than 0 are lost going to Unix). */
export function convertCron(expr: string, from: CronFormat, to: CronFormat): string {
  if (from === to || !expr.trim() || expr.trim().startsWith('@')) return expr
  const f = fieldsOf(expr)
  const source = CRON_DIALECTS[from]
  const out = fromCrontab(source.toCrontab(f).join(' '), to)
  // the seconds go along (a dialect without them has none — 0)
  return CRON_DIALECTS[to].seconds ? `${source.seconds ? f[0] : '0'}${out.slice(1)}` : out
}
/** A crontab expression in another dialect (seconds added; Quartz: «?» and days 1–7). */
export const fromCrontab = (expr: string, to: CronFormat): string => CRON_DIALECTS[to].fromCrontab(expr)
