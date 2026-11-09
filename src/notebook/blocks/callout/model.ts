/** The callout component's model: an Obsidian-style quote `> [!info] Title` with its body on the `>` lines. */
/** The callouts as Obsidian draws them (Markdown Preview Enhanced and others follow it): kind, icon, colour. */
export const CALLOUTS = [
  { id: 'note', title: 'Заметка', icon: 'pencil', color: 'var(--callout-note)' },
  { id: 'abstract', title: 'Кратко', icon: 'clipboardList', color: 'var(--callout-abstract)' },
  { id: 'info', title: 'Информация', icon: 'info', color: 'var(--callout-info)' },
  { id: 'todo', title: 'Задача', icon: 'checkCircle', color: 'var(--callout-todo)' },
  { id: 'tip', title: 'Совет', icon: 'flame', color: 'var(--callout-tip)' },
  { id: 'success', title: 'Готово', icon: 'check', color: 'var(--callout-success)' },
  { id: 'question', title: 'Вопрос', icon: 'helpCircle', color: 'var(--callout-question)' },
  { id: 'warning', title: 'Внимание', icon: 'alertTriangle', color: 'var(--callout-warning)' },
  { id: 'failure', title: 'Не вышло', icon: 'x', color: 'var(--callout-failure)' },
  { id: 'danger', title: 'Опасно', icon: 'zap', color: 'var(--callout-danger)' },
  { id: 'bug', title: 'Ошибка', icon: 'bug', color: 'var(--callout-bug)' },
  { id: 'example', title: 'Пример', icon: 'list', color: 'var(--callout-example)' },
  { id: 'quote', title: 'Цитата', icon: 'quote', color: 'var(--callout-quote)' },
] as const satisfies ReadonlyArray<{ id: string; title: string; icon: string; color: string }>
export type CalloutType = (typeof CALLOUTS)[number]['id']
const isCalloutType = (s: string): s is CalloutType => CALLOUTS.some((c) => c.id === s)
/** The other names of the kinds (Obsidian's): each drawn as its kind. */
const CALLOUT_ALIAS: Record<string, CalloutType> = { summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' }
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
