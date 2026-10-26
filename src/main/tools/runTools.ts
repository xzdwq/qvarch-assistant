import { hostAllowed, type McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'
import { notePath, opt, str } from './toolArgs'
import { RUN_GUIDE } from './runGuide'
import { QA_CHECKS } from '../../shared/qaChecks'
import { checkBlockIn } from '../../notebook/blocks/pw/model'

/** The ready checks of a Playwright scenario, as the agent is told of them (from the list «Проверить ▾» shows). */
const CHECKS_GUIDE = [
  '## Готовые проверки сценария Playwright («Проверить ▾»)',
  'Сценарий — действия пользователя в блоке ```ts playwright name=… (часто записанные им во встроенном браузере: «Записать»). Готовая проверка оборачивает эти действия и даёт отчёт (таблицы «до / после», снимки, дубли запросов). Навешивай её инструментом pw_check (path, block, kind), а не пиши такую проверку руками; потом note_run и вывод в документ.',
  'Выбирай проверки по просьбе пользователя или сам — по тому, что делает сценарий (сохранение формы — leave, reload, double; таблица — load; поля — matrix; запрос поиска — fuzz; вёрстка — layout).',
  ...QA_CHECKS.map((k) => `- ${k.id} — ${k.label}: ${k.hint}`),
  'Смена контекста одним сценарием: действия → pw_check kind=context (запомнить поля) → допиши в сценарий переключение контекста (note_edit) → pw_check kind=compare.',
  'load и matrix меняют данные на сервере (строки, сохранения) — перед запуском скажи об этом пользователю. Сценарий пользователя правь бережно: его действия и локаторы — основа, меняй то, что падает.',
].join('\n')

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
      run: async () => `${RUN_GUIDE}\n${CHECKS_GUIDE}`,
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
      name: 'pw_check',
      access: 'write',
      description: `Навесить на сценарий Playwright (блок name=… в заметке) готовую проверку — так же, как пункт «Проверить ▾» у блока: ${QA_CHECKS.map((k) => k.id).join(', ')}. Что каждая делает и что ей нужно в сценарии — qvarch_guide, раздел «Готовые проверки». Не подходит — вернёт причину. Потом — note_run.`,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, block: { type: 'string', description: 'Имя блока Playwright (name=…)' }, kind: { type: 'string', enum: QA_CHECKS.map((k) => k.id) } },
        required: ['path', 'block', 'kind'],
      },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        const check = QA_CHECKS.find((k) => k.id === a.kind)
        if (!check) throw new Error(`Нет проверки ${String(a.kind)}: есть ${QA_CHECKS.map((k) => k.id).join(', ')}`)
        const r = checkBlockIn(await c.ui<string>('read', { path }), str(a.block, 'block', 120), check.id)
        if ('error' in r) throw new Error(r.error)
        await c.ui('write', { path, text: r.text })
        return `Проверка «${check.label}» добавлена в «${String(a.block)}» (${path}). Запуск — note_run.`
      },
    },
    {
      name: 'page_look',
      access: 'run',
      description:
        'Посмотреть страницу во встроенном браузере: что на ней можно нажать и заполнить, с готовыми локаторами (как пишет запись сценария) — не DOM. Вызывай ТОЛЬКО когда пользователь прямо попросил посмотреть страницу; иначе работай по записанному им сценарию. url — открыть этот адрес (вход — пользователя); пусто — страница, открытая у пользователя сейчас.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      run: async (a) => {
        const url = opt(a.url)
        if (url && !/^https?:\/\//i.test(url)) throw new Error('Только http(s) адреса')
        return c.lookAtPage(url)
      },
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
