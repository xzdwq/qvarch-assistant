import { randomUUID } from 'node:crypto'
import type { McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'
import { opt, str } from './toolArgs'

/** Rows of a trial query the AI sees (the rest — counted). */
const ROWS_SHOWN = 30
/** A cell's text is cut after this many characters. */
const CELL_MAX = 200

/** How a SQL block is written right: the connection taken from the list, the columns from the schema, tried first. */
export const DB_RULES = [
  'Как работать с базами данных:',
  '- db=… в блоке ```sql — только имя подключения из db_connections. Не выдумывай подключение и не создавай его: подходящего нет — скажи пользователю.',
  '- Поля таблицы бери из db_schema (это тот же источник, что и ER-диаграмма компонента). Перечисляй поля явно — select id, name, price from product — а не select *.',
  '- Проверь запрос через db_query (только чтение, первые строки) до того, как вставлять блок; после вставки — note_run, чтобы блок выполнился в документе.',
].join('\n')

const cell = (v: unknown) => {
  const t = v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return t.length > CELL_MAX ? `${t.slice(0, CELL_MAX)}…` : t
}

/** The person's databases for the AI: the connections' names, a table's columns, a trial query (read-only). */
export function dbTools(c: ToolCtx): McpTool[] {
  return [
    {
      name: 'db_connections',
      access: 'read',
      description: 'Подключения к базам данных пользователя («Базы данных»): имя (его пишут в блок ```sql db=<имя>), тип, база. Без паролей. Все подключения — только чтение.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const list = c.db.conns()
        const rows = list.map((x) => `- ${x.name} — ${x.kind}${x.database ? `, база ${x.database}` : ''}${x.host ? ` на ${x.host}` : x.file ? ` (${x.file})` : ''}${x.prod ? ' · ПРОД' : ''}`)
        return `${rows.length ? rows.join('\n') : 'Подключений нет — пользователь добавляет их в «Базы данных» (шестерёнка у блока SQL).'}\n\n${DB_RULES}`
      },
    },
    {
      name: 'db_schema',
      access: 'read',
      description: 'Таблицы и их поля (с типами) в базе подключения — как на ER-диаграмме. table — одна таблица (имя или schema.имя); пусто — список таблиц.',
      inputSchema: { type: 'object', properties: { conn: { type: 'string', description: 'Имя подключения (db_connections)' }, table: { type: 'string' } }, required: ['conn'] },
      run: async (a) => {
        const conn = str(a.conn, 'conn', 200)
        const s = await c.db.schema(conn)
        if ('error' in s) return `Ошибка: ${s.error}`
        const want = opt(a.table)?.toLowerCase()
        const full = (t: { schema?: string; name: string }) => (t.schema && t.schema !== s.defaultSchema ? `${t.schema}.${t.name}` : t.name)
        if (!want) return `Таблиц: ${s.tables.length}\n${s.tables.map(full).join(', ')}`
        const t = s.tables.find((x) => full(x).toLowerCase() === want || x.name.toLowerCase() === want)
        if (!t) return `Таблицы «${opt(a.table)}» нет. Похожие: ${s.tables.filter((x) => x.name.toLowerCase().includes(want)).map(full).slice(0, 20).join(', ') || '—'}`
        return `${full(t)}:\n${t.columns.map((col) => `- ${col.name}${col.type ? ` ${col.type}` : ''}`).join('\n')}`
      },
    },
    {
      name: 'db_query',
      access: 'run',
      description: `Выполнить пробный запрос (только чтение) в подключении и посмотреть первые ${ROWS_SHOWN} строк — чтобы проверить запрос перед тем, как вставить его в блок SQL.`,
      inputSchema: { type: 'object', properties: { conn: { type: 'string' }, sql: { type: 'string' } }, required: ['conn', 'sql'] },
      run: async (a) => {
        const r = await c.db.query(str(a.conn, 'conn', 200), str(a.sql, 'sql', 20_000))
        if (!r.ok || !r.run?.result) return `Ошибка: ${r.error ?? 'нет результата'}`
        const res = r.run.result
        const head = res.columns.map((x) => x.name).join(' | ')
        const rows = res.rows.slice(0, ROWS_SHOWN).map((row) => row.map(cell).join(' | '))
        const more = res.rows.length > ROWS_SHOWN || res.more ? `\n… строк больше, показаны первые ${ROWS_SHOWN}` : ''
        return `${head}\n${rows.join('\n')}${more}\n(${res.rows.length} строк, ${res.ms} мс)`
      },
    },
  ]
}

/** A trial query's own id (a run the store knows: stopped with the others when the app closes). */
export const trialRunId = () => `ai-${randomUUID()}`
