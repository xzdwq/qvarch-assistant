import { dayStart, shiftDay } from './timeline'
import type { Ms } from './types'

/**
 * Quick add («Моя работа»): one line of text → a block. Recognised and taken out of the title:
 *   time        14:00-15:30 · 14-15 · с 9 до 11 · 14:00 · в 9:30
 *   duration    30м · 1ч · 1.5ч · 1ч30м · 45 мин
 *   task        ABC-123 · Q-7
 *   kind        #встреча (a kind's name or its start)
 *   day         сегодня · завтра · послезавтра · вчера · пн…вс (in the shown week) · 16.10
 * The rest is the title.
 */
export interface QuickCtx {
  /** The day the line goes to unless it names another. */
  day: string
  /** Monday of the shown week (for "пн…вс"). */
  weekStart: string
  kinds: Array<{ id: string; label: string }>
}
export interface QuickPart {
  type: 'time' | 'dur' | 'task' | 'kind' | 'day'
  text: string
}
export interface Quick {
  label: string
  day: string
  kind?: string
  task?: string
  start?: Ms
  end?: Ms
  dur?: Ms
  parts: QuickPart[]
}

const H = 3_600_000
const M = 60_000
const B = '(^|\\s)'
const E = '(?=\\s|$|[,;])'
const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(пн|понедельник)$/i, 0],
  [/^(вт|вторник)$/i, 1],
  [/^(ср|среда|среду)$/i, 2],
  [/^(чт|четверг)$/i, 3],
  [/^(пт|пятница|пятницу)$/i, 4],
  [/^(сб|суббота|субботу)$/i, 5],
  [/^(вс|воскресенье)$/i, 6],
]

export function parseQuick(text: string, ctx: QuickCtx): Quick {
  let s = ` ${text} `
  const parts: QuickPart[] = []
  const out: Quick = { label: '', day: ctx.day, parts }
  /** Finds the first match, takes it out of the text, gives its groups. */
  const take = (re: RegExp, type: QuickPart['type'], ok: (m: RegExpMatchArray) => boolean = () => true): RegExpMatchArray | undefined => {
    for (const m of s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      if (!ok(m)) continue
      const i = (m.index ?? 0) + m[1].length
      const whole = m[0].slice(m[1].length)
      s = `${s.slice(0, i)} ${s.slice(i + whole.length)}`
      parts.push({ type, text: whole.trim() })
      return m
    }
    return undefined
  }

  // ---------- the day ----------
  const word = take(new RegExp(`${B}(сегодня|завтра|послезавтра|вчера)${E}`, 'i'), 'day')
  if (word) out.day = shiftDay(ctx.day, { сегодня: 0, завтра: 1, послезавтра: 2, вчера: -1 }[word[2].toLowerCase() as 'сегодня'] ?? 0)
  else {
    const wd = take(new RegExp(`${B}(?:во?\\s+)?([а-яё]{2,12})${E}`, 'i'), 'day', (m) => WEEKDAYS.some(([re]) => re.test(m[2])))
    if (wd) out.day = shiftDay(ctx.weekStart, WEEKDAYS.find(([re]) => re.test(wd[2]))![1])
    else {
      // 16.10 / 16.10.2026 — a date only when the second number can be a month and it is not a range
      const dm = take(new RegExp(`${B}(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?${E}`), 'day', (m) => +m[3] >= 1 && +m[3] <= 12 && +m[2] >= 1 && +m[2] <= 31)
      if (dm) {
        const y = dm[4] ? (dm[4].length === 2 ? 2000 + +dm[4] : +dm[4]) : +ctx.day.slice(0, 4)
        out.day = `${y}-${dm[3].padStart(2, '0')}-${dm[2].padStart(2, '0')}`
      }
    }
  }
  const at = (h: string, m?: string) => dayStart(out.day) + +h * H + (m ? +m : 0) * M
  const hm = (h: string, m?: string) => +h <= 24 && (!m || +m < 60)

  // ---------- the time ----------
  const range = take(new RegExp(`${B}(?:с\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:[-–—]|до)\\s*(\\d{1,2})(?:[:.](\\d{2}))?${E}`, 'i'), 'time', (m) => hm(m[2], m[3]) && hm(m[4], m[5]))
  if (range) {
    out.start = at(range[2], range[3])
    const end = at(range[4], range[5])
    if (end > out.start) out.end = end
  } else {
    const one = take(new RegExp(`${B}(?:в\\s+|с\\s+)?(\\d{1,2})[:.](\\d{2})${E}`, 'i'), 'time', (m) => hm(m[2], m[3]))
    if (one) out.start = at(one[2], one[3])
  }

  // ---------- the duration ----------
  const hrs = take(new RegExp(`${B}(\\d+(?:[.,]\\d+)?)\\s*(?:ч|час|часа|часов|h)(?:\\s*(\\d+)\\s*(?:м|мин|m))?${E}`, 'i'), 'dur')
  if (hrs) out.dur = Math.round(parseFloat(hrs[2].replace(',', '.')) * H + (hrs[3] ? +hrs[3] * M : 0))
  else {
    const min = take(new RegExp(`${B}(\\d+)\\s*(?:м|мин|минут|минуты|m)${E}`, 'i'), 'dur')
    if (min) out.dur = +min[2] * M
  }
  if (out.dur !== undefined && out.dur <= 0) out.dur = undefined
  if (out.start !== undefined && out.end === undefined && out.dur) out.end = out.start + out.dur

  // ---------- the task ----------
  const task = take(new RegExp(`${B}([A-Za-z][A-Za-z0-9_]*-\\d+)(?=\\s|$|[,.:;])`), 'task')
  if (task) out.task = task[2].toUpperCase()

  // ---------- the kind ----------
  const kind = take(new RegExp(`${B}#(\\S+)`), 'kind', (m) => !!findKind(ctx.kinds, m[2]))
  if (kind) out.kind = findKind(ctx.kinds, kind[2])!.id

  out.label = s.replace(/\s+/g, ' ').replace(/^[\s,;:—-]+|[\s,;:—-]+$/g, '')
  return out
}

/** A kind by its id, its name or the start of its name. */
function findKind(kinds: QuickCtx['kinds'], q: string): QuickCtx['kinds'][number] | undefined {
  const t = q.toLowerCase()
  return kinds.find((k) => k.id.toLowerCase() === t) ?? kinds.find((k) => k.label.toLowerCase() === t) ?? kinds.find((k) => k.label.toLowerCase().startsWith(t))
}
