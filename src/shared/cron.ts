import cronstrue from 'cronstrue/i18n'
import { CronExpressionParser } from 'cron-parser'

/**
 * Cron expressions: what one means in Russian (cronstrue) and when it runs next (cron-parser), for the three
 * usual dialects — Unix crontab (5 fields), Spring @Scheduled (6: seconds first) and Quartz (6–7: seconds,
 * `?` for "no specific day", days of week 1–7 from Sunday, an optional year).
 */
export type CronFormat = 'crontab' | 'spring' | 'quartz'
export const CRON_FORMATS: Array<{ id: CronFormat; title: string; hint: string }> = [
  { id: 'crontab', title: 'Unix', hint: 'crontab, Kubernetes CronJob, GitHub Actions: минута час день месяц день-недели' },
  { id: 'spring', title: 'Spring', hint: '@Scheduled(cron = …): секунда минута час день месяц день-недели (0–7, 0 и 7 — воскресенье)' },
  { id: 'quartz', title: 'Quartz', hint: 'Quartz, Jenkins-подобные планировщики: секунда … день-недели (1–7, 1 — воскресенье), ? — «не важно», [год]' },
]
const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}
const fieldsOf = (e: string) => e.trim().split(/\s+/).filter(Boolean)

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
/** The expression as cron-parser reads it (5 fields, or 6 with seconds first). */
export function forParser(expr: string, format: CronFormat): string {
  const t = expr.trim()
  if (t.startsWith('@')) return MACROS[t.toLowerCase()] ?? t
  const f = fieldsOf(t)
  if (format === 'crontab') {
    if (f.length !== 5) throw new Error(`В Unix-формате 5 полей (минута час день месяц день-недели), а здесь ${f.length}`)
    return f.join(' ')
  }
  if (format === 'spring') {
    if (f.length !== 6) throw new Error(`В Spring 6 полей (секунда минута час день месяц день-недели), а здесь ${f.length}`)
    return f.join(' ')
  }
  if (f.length !== 6 && f.length !== 7) throw new Error(`В Quartz 6 или 7 полей (секунда … день-недели [год]), а здесь ${f.length}`)
  if (f[3] !== '?' && f[5] !== '?') throw new Error('В Quartz день месяца или день недели должен быть «?» (не важно)')
  return [f[0], f[1], f[2], f[3], f[4], quartzDow(f[5])].join(' ')
}

/** In words, Russian (throws on a broken expression). */
export function describeCron(expr: string, format: CronFormat): string {
  const t = expr.trim()
  const src = t.startsWith('@') ? (MACROS[t.toLowerCase()] ?? t) : t
  return cronstrue.toString(src, { locale: 'ru', use24HourTimeFormat: true, dayOfWeekStartIndexZero: format !== 'quartz', throwExceptionOnParseError: true, verbose: false })
}

/** The next runs (local time unless a time zone is given); a Quartz year limits them. */
export function nextRuns(expr: string, format: CronFormat, count = 10, from = new Date(), tz?: string): Date[] {
  const p = CronExpressionParser.parse(forParser(expr, format), { currentDate: from, ...(tz ? { tz } : {}) })
  const f = fieldsOf(expr)
  const years = format === 'quartz' && f.length === 7 && f[6] !== '*' && f[6] !== '?' ? yearSet(f[6]) : undefined
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
  let tab: string
  if (from === 'crontab') tab = f.join(' ')
  else if (from === 'spring') tab = f.slice(1, 6).join(' ')
  else tab = [f[1], f[2], f[3] === '?' ? '*' : f[3], f[4], f[5] === '?' ? '*' : quartzDow(f[5])].join(' ')
  const sec = from === 'crontab' ? '0' : f[0]
  const out = fromCrontab(tab, to)
  return to === 'crontab' ? out : `${sec}${out.slice(1)}`
}
/** A crontab expression in another dialect (seconds added; Quartz: «?» and days 1–7). */
export function fromCrontab(expr: string, to: CronFormat): string {
  if (to === 'crontab') return expr
  const [mi, h, dom, mon, dow] = fieldsOf(expr)
  if (to === 'spring') return `0 ${mi} ${h} ${dom} ${mon} ${dow}`
  const qDow = dow === '*' ? '?' : dow.split(',').map((p) => p.replace(/\d+/g, (d) => String((Number(d) % 7) + 1))).join(',')
  return `0 ${mi} ${h} ${dow === '*' ? dom : '?'} ${mon} ${qDow}`
}
