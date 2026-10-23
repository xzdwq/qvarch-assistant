import { compileWatch, VAR_NAME, type TermAlert, type TermSession, type TermVar, type TermWatch } from './terminal'

/** «{{ name }}» — how a variable is written in a preset. */
export const insertOf = (name: string): string => '{{ ' + name + ' }}'

/** Why a variable being edited cannot be kept ('' — it can). */
export function varNameError(v: TermVar, vars: TermVar[]): string {
  if (!VAR_NAME.test(v.name)) return 'Имя — латинские буквы, цифры, _ и $, не с цифры'
  if (vars.some((x) => x.name === v.name && x.id !== v.id)) return 'Такая переменная уже есть'
  return ''
}

/** Why a reaction being edited cannot be kept ('' — it can): no pattern, or a broken regex. */
export function watchEditError(w: TermWatch): string {
  try {
    return compileWatch(w) ? '' : 'Нужно хотя бы одно слово или регулярка'
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
/** What a valid reaction would catch in a test line: the match (its text), or null — nothing. */
export function watchTestMatch(w: TermWatch, line: string): string | null {
  const r = compileWatch(w)
  if (!r) return null
  const m = new RegExp(r.source, r.flags.replace('g', '')).exec(line)
  return m ? m[0] || '(пустое совпадение)' : null
}
/** A reaction's patterns in one line (the list shows them so). */
export const watchPatternsShort = (w: TermWatch): string =>
  w.patterns
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ')

/** An edited item put back into its list: in its place, or at the end when new. */
export function upsertById<T extends { id: string }>(list: T[], item: T): void {
  const i = list.findIndex((x) => x.id === item.id)
  if (i >= 0) list[i] = { ...item }
  else list.push({ ...item })
}
/** A list with one item moved from one place to another (a new array). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list]
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

/** A shell tab's light: a notice of its own (blinking in its colour), a command going, a failure, or nothing. */
export function shellLight(alerts: TermAlert[], id: string, s: TermSession | undefined): { cls: string; style?: Record<string, string> } {
  const a = alerts.find((x) => x.sid === id)
  if (a) return { cls: 'alert', style: { background: a.color, boxShadow: `0 0 6px ${a.color}` } }
  if (!s) return { cls: '' }
  if (s.busy) return { cls: 'run' }
  if (s.failed !== undefined) return { cls: 'err' }
  return { cls: '' }
}
