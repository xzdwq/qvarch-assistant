import { dayKey, MINUTE } from '../../shared/timeline'
import { findKind, isProductive } from '../../shared/kinds'
import { noteLinkUrl } from '../../shared/noteEvents'
import { WORK_PERIODS, workRange, workReport } from '../../notebook/blocks/work/model'
import type { McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'
import { opt } from './toolArgs'

const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const hours = (ms: number) => `${Math.floor(ms / 3_600_000)} ч ${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, '0')} мин`
/** A task's link as a note writes it (opens as a card, for every reader). */
const issueLink = (key: string, title: string) => `[${`${key} ${title === key ? '' : title}`.replace(/[[\]]/g, ' ').trim()}](${noteLinkUrl({ kind: 'jira', key })})`
/** The days from — to (YYYY-MM-DD, inclusive; at most a year). */
function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  const [y, m, d] = from.split('-').map(Number)
  for (let t = new Date(y, m - 1, d); dayKey(t.getTime()) <= to && out.length < 366; t.setDate(t.getDate() + 1)) out.push(dayKey(t.getTime()))
  return out
}

/** Jira's tasks and the work's time: a task read or found, the work of a day, the time kept. */
export function workTools(c: ToolCtx): McpTool[] {
  return [
    {
      name: 'jira_issue',
      access: 'read',
      description: 'Задача Jira из кэша Qvarch: название, статус, тип, исполнитель, описание (Markdown). Без ключа — поиск по тексту.',
      inputSchema: { type: 'object', properties: { key: { type: 'string' }, query: { type: 'string', description: 'Поиск по названию / описанию' } } },
      run: async (a) => {
        const key = opt(a.key)?.toUpperCase()
        if (key) {
          const i = c.issue(key)
          if (!i) return `Задачи ${key} нет в кэше Qvarch (синхронизация Jira в «Моей работе»). Ссылка всё равно: ${issueLink(key, key)}`
          return [
            `${i.key} — ${i.summary}`,
            `Статус: ${i.status} · ${i.type}${i.priority ? ` · ${i.priority}` : ''}${i.assignee ? ` · ${i.assignee}` : ''}${i.due ? ` · срок ${i.due}` : ''}`,
            i.labels?.length ? `Метки: ${i.labels.join(', ')}` : '',
            `Ссылка для документа: ${issueLink(i.key, i.summary)}`,
            '',
            i.description ?? '(без описания)',
          ]
            .filter((x) => x !== '')
            .join('\n')
        }
        const q = opt(a.query)
        if (!q) throw new Error('Нужен key или query')
        const list = c.findIssues(q)
        return list.length ? list.map((i) => `${issueLink(i.key, i.summary)} (${i.status})`).join('\n') : 'Ничего не найдено'
      },
    },
    {
      name: 'work_today',
      access: 'read',
      description: 'Записи времени «Моей работы» за сегодня (или за день YYYY-MM-DD), у каждой — ссылка на событие для документа.',
      inputSchema: { type: 'object', properties: { day: { type: 'string' } } },
      run: async (a) => {
        const day = opt(a.day) ?? dayKey(Date.now())
        const es = [...c.day(day).entries].sort((x, y) => x.start - y.start)
        return es.length ? es.map((e) => `${hm(e.start)}–${hm(e.end)} [${e.label.replace(/[[\]]/g, ' ')}](${noteLinkUrl({ kind: 'event', day, id: e.id })})${e.task ? ` [${e.task.key}]` : ''}${e.outlook ? ' (Outlook)' : ''}`).join('\n') : `${day}: записей нет`
      },
    },
    {
      name: 'work_period',
      access: 'read',
      description: `Итоги работы за период: всего, по дням, по видам, по задачам. period — ${WORK_PERIODS.map((p) => p.id).join(' | ')}; для custom — from и to (YYYY-MM-DD). Чтобы показать итоги в документе — вставь компонент work (note_components).`,
      inputSchema: { type: 'object', properties: { period: { type: 'string', enum: WORK_PERIODS.map((p) => p.id) }, from: { type: 'string' }, to: { type: 'string' } } },
      run: async (a) => {
        const period = WORK_PERIODS.find((p) => p.id === opt(a.period))?.id ?? (opt(a.from) ? 'custom' : 'this-week')
        const range = workRange({ period, view: 'table', from: opt(a.from), to: opt(a.to) })
        const kinds = c.kinds()
        const days = daysOf(range.from, range.to).map((day) => ({ day, entries: c.day(day).entries.map((e) => ({ id: e.id, kind: e.kind, label: e.label, task: e.task?.key, start: e.start, end: e.end })) }))
        const r = workReport(days, (k) => isProductive(kinds, k))
        const tasks = new Map<string, number>()
        for (const d of r.days) for (const it of d.items) if (it.task) tasks.set(it.task, (tasks.get(it.task) ?? 0) + it.end - it.start)
        return [
          `Период ${range.from} — ${range.to}: всего ${hours(r.total)}`,
          `По дням: ${r.days.map((d) => `${d.day} ${hours(d.total)}`).join('; ') || 'нет работы'}`,
          `По видам: ${r.byKind.map((k) => `${findKind(kinds, k.kind).label} ${hours(k.ms)} (${k.count})`).join('; ') || '—'}`,
          `По задачам: ${[...tasks].sort((x, y) => y[1] - x[1]).map(([key, ms]) => `${issueLink(key, c.issue(key)?.summary ?? key)} ${hours(ms)}`).join('; ') || '—'}`,
          `В документ: \`\`\`work\nperiod: ${period}${period === 'custom' ? `\nfrom: ${range.from}\nto: ${range.to}` : ''}\nview: table\n\`\`\``,
        ].join('\n')
      },
    },
    {
      name: 'work_track',
      access: 'write',
      description: 'Учёт времени работы: если сегодня есть запись по этой задаче (key) или с этим названием, которая идёт сейчас или закончилась не больше 30 минут назад, — продлевает её до текущего времени; иначе создаёт новую от текущего момента (15 мин). Вызывай в начале работы и время от времени, пока работаешь. Ничего не удаляет и не переносит.',
      inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Ключ задачи Jira' }, label: { type: 'string', description: 'Что делается, например «Автотесты ABC-123»' } } },
      run: async (a) => {
        const key = opt(a.key)?.toUpperCase()
        const issue = key ? c.issue(key) : undefined
        const label = opt(a.label) ?? (key ? `${key} · автотесты` : '')
        if (!label) throw new Error('Нужен key или label')
        const now = Date.now()
        const day = dayKey(now)
        const step = 5 * MINUTE
        const up = Math.ceil(now / step) * step
        const mine = c
          .day(day)
          .entries.filter((e) => !e.outlook && (key ? e.task?.key === key : e.label === label))
          .sort((x, y) => y.end - x.end)[0]
        if (mine && mine.start <= now && now - mine.end <= 30 * MINUTE) {
          if (mine.end >= up) return `Запись «${mine.label}» уже идёт до ${hm(mine.end)}`
          const e = c.saveEntry(day, { ...mine, end: up }, { overlap: true })
          return `Продлено: «${e.label}» ${hm(e.start)}–${hm(e.end)}`
        }
        const start = Math.floor(now / step) * step
        const e = c.saveEntry(day, { start, end: start + 15 * MINUTE, kind: 'task', label, source: 'ai', ...(key ? { task: { key, summary: issue?.summary ?? label } } : {}) }, { overlap: true })
        return `Создано: «${e.label}» ${hm(e.start)}–${hm(e.end)}${key ? ` [${key}]` : ''}`
      },
    },
  ]
}
