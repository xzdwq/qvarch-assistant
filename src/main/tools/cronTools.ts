import { cronCheck, jobTitle, nextDue, type CronJob, type CronRun } from '../../shared/cronJobs'
import type { McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'
import { notePath, opt, str } from './toolArgs'

/** What a scheduled note is for the agent: its schedule in words, its next and last runs. */
const RUN_WORD: Record<CronRun['state'], string> = { ok: 'выполнен', error: 'ошибка', missed: 'пропущен' }
const when = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
function jobLine(j: CronJob): string {
  const c = cronCheck(j.expr, 1)
  const next = nextDue(j)
  const last = j.runs[0]
  return [
    `- id=${j.id} «${jobTitle(j)}» — ${j.note}`,
    `  ${j.expr}${c.ok ? ` (${c.words})` : ''} · ${j.on ? 'включено' : 'выключено'}${next ? ` · следующий ${when(next)}` : ''}`,
    last ? `  последний: ${when(last.at)} ${RUN_WORD[last.state]}${last.count && last.count > 1 ? ` ×${last.count}` : ''}${last.error ? ` — ${last.error}` : ''}` : '  ещё не запускалось',
  ].join('\n')
}
const SCHEDULE_GUIDE =
  'Запуск по расписанию = «Выполнить всё» заметки в фоне. В заметке при этом есть значение {{trigger}}: trigger.by — cron | hand | ai, trigger.cron — { title, expr }. Чтобы по расписанию написать в чат документа (и позвать ИИ): блок ```md template name=… chat``` — его текст (с {{ значениями }}, например из блока кода `return new Date().toLocaleString()`) уходит в чат при каждом выполнении; упоминание «@ИИ · Имя» в тексте зовёт этого ИИ, сообщение помечено «⏰ по расписанию».'

/** Schedules: notes run by cron (list, made, changed, deleted, run now). */
export function cronTools(c: ToolCtx): McpTool[] {
  const jobOf = (id: string) => {
    const j = c.crons.list().find((x) => x.id === id)
    if (!j) throw new Error(`Нет расписания id=${id} — список: cron_list`)
    return j
  }
  return [
    {
      name: 'cron_list',
      access: 'read',
      description: `Все расписания заметок (cron): заметка, выражение и его смысл, включено ли, следующий и последний запуск (выполнен / ошибка / пропущен — приложение было закрыто). ${SCHEDULE_GUIDE}`,
      inputSchema: { type: 'object', properties: {} },
      run: async () => (c.crons.list().length ? c.crons.list().map(jobLine).join('\n') : 'Расписаний нет'),
    },
    {
      name: 'cron_create',
      access: 'write',
      description: `Поставить заметку на выполнение по расписанию. expr — cron: 5 полей «мин час день месяц день_недели» (0 9 * * 1-5 — по будням в 9:00) или 6 с секундами первыми. ${SCHEDULE_GUIDE}`,
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, expr: { type: 'string' }, title: { type: 'string', description: 'Название (пусто — имя заметки)' } }, required: ['path', 'expr'] },
      run: async (a) => {
        const expr = str(a.expr, 'expr', 200)
        const check = cronCheck(expr)
        if (!check.ok) throw new Error(`Неверное выражение: ${check.error}`)
        return `Создано:\n${jobLine(c.crons.save({ note: notePath(str(a.path, 'path', 1000)), expr, title: opt(a.title) ?? '', on: true }))}`
      },
    },
    {
      name: 'cron_set',
      access: 'write',
      description: 'Изменить расписание: включить / выключить (on), новое выражение (expr), название (title).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, on: { type: 'boolean' }, expr: { type: 'string' }, title: { type: 'string' } }, required: ['id'] },
      run: async (a) => {
        const j = jobOf(str(a.id, 'id', 100))
        const expr = opt(a.expr)
        if (expr) {
          const check = cronCheck(expr)
          if (!check.ok) throw new Error(`Неверное выражение: ${check.error}`)
        }
        return jobLine(c.crons.save({ id: j.id, ...(typeof a.on === 'boolean' ? { on: a.on } : {}), ...(expr ? { expr } : {}), ...(typeof a.title === 'string' ? { title: a.title } : {}) }))
      },
    },
    {
      name: 'cron_delete',
      access: 'write',
      description: 'Удалить расписание (заметка остаётся).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (a) => {
        const j = jobOf(str(a.id, 'id', 100))
        c.crons.remove(j.id)
        return `Удалено расписание «${jobTitle(j)}»`
      },
    },
    {
      name: 'cron_run',
      access: 'run',
      description: 'Выполнить расписание сейчас (как по времени: trigger.by = cron) и дождаться итога. Отчёт по блокам — note_results.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (a) => {
        const r = await c.crons.runNow(jobOf(str(a.id, 'id', 100)).id)
        return `${RUN_WORD[r.state]}${r.ms !== undefined ? ` за ${Math.round(r.ms / 1000)} с` : ''}${r.error ? ` — ${r.error}` : ''}`
      },
    },
  ]
}
