import { hostAllowed, type McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'
import { notePath, opt, str } from './toolArgs'
import { RUN_GUIDE } from './runGuide'

/** The hosts a note talks to (any http(s) address in it — its data, its requests, its tests). */
function hostsOf(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+(?::\d+)?)/gi)) out.add(m[1].toLowerCase().replace(/:\d+$/, ''))
  return [...out]
}

/** Running: the guide to runnable notes, a run (hosts off the allowed list — the user is asked), its results, the browser. */
export function runTools(c: ToolCtx): McpTool[] {
  const approved = new Set<string>()
  /** A run's hosts checked: the allowed ones go, the others — the user is asked (once per host and app run). */
  async function guardHosts(text: string, what: string): Promise<void> {
    const bad = hostsOf(text).filter((h) => !hostAllowed(h, c.allow()) && !approved.has(h))
    if (!bad.length) return
    if (!(await c.confirmHosts(bad, what))) throw new Error(`Пользователь не разрешил запуск против ${bad.join(', ')} — эти адреса не в списке разрешённых (Настройки → ИИ-агенты). Предложи стенд *-dev / *-qa или спроси пользователя.`)
    for (const h of bad) approved.add(h)
  }

  return [
    {
      name: 'qvarch_guide',
      access: 'read',
      description: 'Как писать исполняемые заметки Qvarch: блоки HTTP / JS-TS / Playwright / SQL / текст по шаблону / данные, циклы, переменные {{ }}, флаги, отчёты. Вызови перед созданием или правкой блоков.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => RUN_GUIDE,
    },
    {
      name: 'note_run',
      access: 'run',
      description: 'Выполнить заметку: все блоки сверху вниз (как «Выполнить всё») или один исполняемый блок / цикл по имени (HTTP, код, Playwright, SQL, текст по шаблону, цикл). Ждёт конца и возвращает отчёт: статусы, шаги тестов, ошибки, результаты. Адреса вне разрешённых (*-dev, *-qa, localhost) пользователь подтверждает.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, block: { type: 'string', description: 'Имя блока или цикла (name=…); пусто — вся заметка' } }, required: ['path'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        const text = await c.ui<string>('read', { path })
        await guardHosts(text, `Запуск заметки «${path}»`)
        return c.ui<string>('run', { path, block: opt(a.block) })
      },
    },
    {
      name: 'note_results',
      access: 'read',
      description: 'Последние результаты заметки без запуска: отчёт по блокам и значения переменных.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async (a) => c.ui<string>('report', { path: notePath(str(a.path, 'path', 1000)) }),
    },
    {
      name: 'browser_open',
      access: 'run',
      description: 'Открыть адрес во встроенном браузере Qvarch (вход пользователя там же — тесты с флагом session его используют).',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: async (a) => {
        const url = str(a.url, 'url', 4000)
        if (!/^https?:\/\//i.test(url)) throw new Error('Только http(s) адреса')
        c.openInBrowser(url)
        return `Открыто: ${url}`
      },
    },
  ]
}
