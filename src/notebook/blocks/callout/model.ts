/** The callout component's model: an Obsidian-style quote `> [!info] Title` with its body on the `>` lines. */
export const CALLOUTS = [
  { id: 'note', title: 'Заметка', icon: 'pencil', color: 'var(--callout-note)' },
  { id: 'info', title: 'Информация', icon: 'bell', color: 'var(--callout-info)' },
  { id: 'tip', title: 'Совет', icon: 'sparkles', color: 'var(--callout-tip)' },
  { id: 'success', title: 'Готово', icon: 'check', color: 'var(--callout-success)' },
  { id: 'warning', title: 'Внимание', icon: 'zap', color: 'var(--callout-warning)' },
  { id: 'danger', title: 'Опасно', icon: 'x', color: 'var(--callout-danger)' },
] as const satisfies ReadonlyArray<{ id: string; title: string; icon: string; color: string }>
export type CalloutType = (typeof CALLOUTS)[number]['id']
const isCalloutType = (s: string): s is CalloutType => CALLOUTS.some((c) => c.id === s)
/** Other tools' callout types, shown as the nearest own one. */
const CALLOUT_ALIAS: Record<string, CalloutType> = { abstract: 'info', summary: 'info', todo: 'info', hint: 'tip', important: 'tip', check: 'success', done: 'success', question: 'info', caution: 'warning', attention: 'warning', failure: 'danger', fail: 'danger', error: 'danger', bug: 'danger', example: 'note', quote: 'note' }
export interface CalloutModel {
  type: CalloutType
  title: string
  body: string
}
/** The first line of a callout: `> [!type]`, folded marks (+/-) allowed. */
export const CALLOUT_START = /^>\s*\[!\w+\][+-]?/
/** A callout written as a fence (as other tools write it): ```callout <type> <title> … ``` — its first line. */
export const CALLOUT_FENCE = /^(`{3,}|~{3,})\s*callout(?:\s+(\w+))?\s*(.*)$/i
const typeOf = (raw: string): CalloutType => {
  const t = raw.toLowerCase()
  return isCalloutType(t) ? t : Object.hasOwn(CALLOUT_ALIAS, t) ? CALLOUT_ALIAS[t] : 'note'
}
export function parseCallout(src: string): CalloutModel {
  const all = src.split('\n')
  const fence = CALLOUT_FENCE.exec(all[0] ?? '')
  // the fence's form: its kind and title on the first line, the text up to the closing fence
  if (fence) return { type: typeOf(fence[2] ?? 'note'), title: fence[3].trim(), body: all.slice(1, -1).join('\n') }
  const lines = all.map((l) => l.replace(/^>\s?/, ''))
  const m = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(lines[0] ?? '')
  return { type: typeOf(m?.[1] ?? 'note'), title: m?.[2] ?? '', body: lines.slice(1).join('\n') }
}
export const calloutMd = (c: CalloutModel) => [`> [!${c.type}]${c.title ? ` ${c.title}` : ''}`, ...(c.body ? c.body.split('\n') : ['']).map((l) => (l ? `> ${l}` : '>'))].join('\n')
