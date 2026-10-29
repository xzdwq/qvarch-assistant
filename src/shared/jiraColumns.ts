/**
 * The fields the task list can show beside a task's key and title — the user picks them («Поля»). Each: its title,
 * its column's width (none — it is shown inside the title's cell, as chips), shown at first or not.
 */
export const JIRA_COLUMNS = ['type', 'status', 'priority', 'assignee', 'reporter', 'creator', 'parent', 'worked', 'due', 'created', 'updated', 'estimate', 'components', 'labels', 'versions'] as const
export type JiraColumn = (typeof JIRA_COLUMNS)[number]

export const JIRA_COLUMN: Record<JiraColumn, { title: string; width?: string; shown: boolean }> = {
  type: { title: 'Тип', width: '96px', shown: true },
  status: { title: 'Статус', width: '120px', shown: true },
  priority: { title: 'Приоритет', width: '76px', shown: true },
  assignee: { title: 'Исполнитель', width: '120px', shown: false },
  reporter: { title: 'Автор', width: '120px', shown: true },
  creator: { title: 'Создатель', width: '120px', shown: false },
  parent: { title: 'Родитель', width: '90px', shown: false },
  worked: { title: 'В работе', width: '64px', shown: true },
  due: { title: 'Срок', width: '48px', shown: true },
  created: { title: 'Создана', width: '60px', shown: true },
  updated: { title: 'Обновлена', width: '60px', shown: false },
  estimate: { title: 'Оценка / размечено', width: '150px', shown: true },
  components: { title: 'Компоненты', shown: true },
  labels: { title: 'Метки', shown: true },
  versions: { title: 'Версии', shown: false },
}
export const DEFAULT_JIRA_COLUMNS: JiraColumn[] = JIRA_COLUMNS.filter((c) => JIRA_COLUMN[c].shown)

/** The columns kept (an unknown one dropped — a field gone in a later version), in the registry's order. */
export const jiraColumnsOf = (v: unknown): JiraColumn[] => (Array.isArray(v) ? JIRA_COLUMNS.filter((c) => v.includes(c)) : DEFAULT_JIRA_COLUMNS)

/** The list row's grid: the fold arrow, «mine», the key, the title, each shown column with a width, «В работу». */
export const jiraGridOf = (cols: readonly JiraColumn[]) => ['18px', '18px', '84px', 'minmax(0,1fr)', ...cols.flatMap((c) => (JIRA_COLUMN[c].width ? [JIRA_COLUMN[c].width] : [])), '28px'].join(' ')
