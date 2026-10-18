/**
 * Events in notes: a note mentions an event of the timeline (or a Jira task) as a Markdown link with the app's
 * own address — readable in any Markdown viewer, shown in the notebook as a live chip (its kind, title, when,
 * done / going on / ahead). `@` in a note opens the list of events to pick from.
 */
export interface EventRef {
  day: string
  id: string
  label: string
  kind: string
  start: number
  end: number
  /** A meeting from Outlook. */
  outlook: boolean
  /** The Jira task the time was spent on. */
  task?: string
  /** When the event was made (unknown for older ones). */
  created?: number
}

export const EVENT_SCHEME = 'qvarch://'
/** `[Label](qvarch://event/2026-10-18/<id>)` */
export const eventLink = (e: Pick<EventRef, 'day' | 'id' | 'label'>) => `[${linkText(e.label)}](${EVENT_SCHEME}event/${e.day}/${e.id})`
/** `[DOS-123 Summary](qvarch://jira/DOS-123)` */
export const jiraLink = (key: string, summary: string) => `[${linkText(`${key} ${summary}`)}](${EVENT_SCHEME}jira/${key})`
const linkText = (s: string) => s.replace(/[[\]\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'событие'

export type NoteLink = { kind: 'event'; day: string; id: string } | { kind: 'jira'; key: string }
export function parseNoteLink(url: string): NoteLink | undefined {
  let m = /^qvarch:\/\/event\/(\d{4}-\d{2}-\d{2})\/([\w-]+)$/.exec(url)
  if (m) return { kind: 'event', day: m[1], id: m[2] }
  m = /^qvarch:\/\/jira\/([A-Z][A-Z0-9_]*-\d+)$/.exec(url)
  if (m) return { kind: 'jira', key: m[1] }
  return undefined
}

export type EventStatus = 'done' | 'now' | 'ahead'
export const statusOf = (e: Pick<EventRef, 'start' | 'end'>, now: number): EventStatus => (now >= e.end ? 'done' : now >= e.start ? 'now' : 'ahead')

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
const hits = (e: EventRef, w: string[]) => {
  if (!w.length) return true
  const s = `${e.label} ${e.task ?? ''}`.toLowerCase()
  return w.every((x) => s.includes(x))
}

export interface PickGroups {
  /** Today: going on first, then the rest of the day (newest first). */
  today: EventRef[]
  /** Planned ahead (Outlook mostly): the nearest first, only a couple of weeks unless searched. */
  ahead: EventRef[]
  /** Before today, newest first; Outlook meetings only of the last two months unless searched. */
  past: EventRef[]
  /** How many more matched than shown, per group (the list stays short and fast). */
  more: { ahead: number; past: number }
}
const DAY = 864e5
/**
 * The picker's groups for a query. Planned meetings would fill the list (a calendar holds months of them), so
 * «ahead» is its own short group: two weeks, or two months when searching. Old Outlook meetings drop off the
 * empty-query list after two months; a search reaches everything.
 */
export function pickGroups(all: EventRef[], query: string, now: number, todayKey: string, limits = { today: 30, ahead: 8, past: 40 }): PickGroups {
  const w = words(query)
  const searching = w.length > 0
  const today: EventRef[] = []
  const ahead: EventRef[] = []
  const past: EventRef[] = []
  for (const e of all) {
    if (!hits(e, w)) continue
    if (e.day === todayKey) today.push(e)
    else if (e.start > now) {
      if (e.start - now <= (searching ? 62 : 14) * DAY) ahead.push(e)
    } else if (!e.outlook || searching || now - e.start <= 62 * DAY) past.push(e)
  }
  const rank = (s: EventStatus) => (s === 'now' ? 0 : s === 'ahead' ? 1 : 2)
  today.sort((a, b) => rank(statusOf(a, now)) - rank(statusOf(b, now)) || (statusOf(a, now) === 'ahead' ? a.start - b.start : b.start - a.start))
  ahead.sort((a, b) => a.start - b.start)
  past.sort((a, b) => b.start - a.start)
  return {
    today: today.slice(0, limits.today),
    ahead: ahead.slice(0, limits.ahead),
    past: past.slice(0, limits.past),
    more: { ahead: Math.max(0, ahead.length - limits.ahead), past: Math.max(0, past.length - limits.past) },
  }
}

const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dm = (t: number, withYear: boolean) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).replace(/\.$/, '')
/** «18 окт, 15:00–16:00» (the other day's end — with its date). */
export function periodText(e: Pick<EventRef, 'start' | 'end'>, now: number): string {
  const y = new Date(e.start).getFullYear() !== new Date(now).getFullYear()
  const sameDay = new Date(e.start).toDateString() === new Date(e.end).toDateString()
  return `${dm(e.start, y)}, ${hm(e.start)}–${sameDay ? hm(e.end) : `${dm(e.end, y)} ${hm(e.end)}`}`
}
/** How long, «1 ч 30 мин». */
export function durText(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  return h ? `${h} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`
}
/** The status in words: «завершено», «идёт · ещё 20 мин», «через 2 ч». */
export function statusText(e: Pick<EventRef, 'start' | 'end'>, now: number): string {
  const s = statusOf(e, now)
  if (s === 'done') return 'завершено'
  if (s === 'now') return `идёт · ещё ${durText(e.end - now)}`
  const d = e.start - now
  return d < 36e5 ? `через ${durText(d)}` : d < DAY ? `через ${Math.round(d / 36e5)} ч` : `через ${Math.round(d / DAY)} дн`
}
