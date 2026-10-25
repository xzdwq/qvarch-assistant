/** A section of «Инструкция» and how its text is written (HTML made from the code's own lists). */

/** The help's groups, in the order the list shows them. */
export const HELP_GROUPS = ['Блокнот', 'Чат и ИИ', 'Тестирование'] as const
export interface HelpSection {
  id: string
  group: (typeof HELP_GROUPS)[number]
  title: string
  icon: string
  html: string
}
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Terms and what each is. */
export const list = (items: Array<[string, string]>) => `<dl>${items.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`
