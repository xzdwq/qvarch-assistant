/**
 * A page as an AI agent looks at it (asked plainly to): not its DOM — what can be acted on, each with the locator a
 * recording would write for it; the headings and an open dialog for where it is. Small by design (a few thousand
 * signs): the elements past the limit are only counted.
 */
export interface PageLookItem {
  role: string
  name: string
  /** The Playwright locator, as code (`page.getByRole('button', { name: 'Сохранить' })`). */
  loc: string
  disabled?: boolean
}
export interface PageLook {
  url: string
  title: string
  headings: string[]
  /** An open dialog's title (the page under it — not acted on now). */
  dialog?: string
  items: PageLookItem[]
  /** Elements left out (past the limit). */
  more: number
}
/** The elements an agent is shown at most. */
export const PAGE_LOOK_MAX = 120
/** The headings shown at most. */
export const PAGE_LOOK_HEADINGS = 15

/** The look as the agent reads it: a line each. */
export function pageLookText(l: PageLook): string {
  return [
    `Страница: ${l.title || '(без заголовка)'} — ${l.url}`,
    l.headings.length ? `Заголовки: ${l.headings.join(' · ')}` : '',
    l.dialog !== undefined ? `Открыт диалог «${l.dialog}» — элементы ниже из него` : '',
    'Элементы (роль «имя» → локатор):',
    ...l.items.map((i) => `- ${i.role} «${i.name}»${i.disabled ? ' (недоступна)' : ''} → ${i.loc}`),
    l.more ? `…и ещё ${l.more} — не показаны (сузьте вопрос: раздел страницы, диалог)` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
