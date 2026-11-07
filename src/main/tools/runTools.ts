import type { McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'
import { notePath, opt, str } from './toolArgs'
import { RUN_GUIDE } from './runGuide'
import { QA_CHECKS } from '../../shared/qaChecks'
import { checkBlockIn } from '../../notebook/blocks/pw/model'
import { checkValuesIn, type CheckValues, type MatrixValue } from '../../notebook/blocks/pw/modelCheckValues'
import type { FuzzParam } from '../../shared/fuzz/spec'
import { MATRIX_MODES, type MatrixMode } from '../../shared/qaMatrixQuery'

/** The ready checks of a Playwright scenario, as the agent is told of them (from the list «Проверить ▾» shows). */
const CHECKS_GUIDE = [
  '## Готовые проверки сценария Playwright («Проверить ▾»)',
  'Сценарий — действия пользователя в блоке ```ts playwright name=… (часто записанные им во встроенном браузере: «Записать»). Готовая проверка оборачивает эти действия и даёт отчёт (таблицы «до / после», снимки, дубли запросов). Навешивай её инструментом pw_check (path, block, kind), а не пиши такую проверку руками; потом note_run и вывод в документ.',
  'Выбирай проверки по просьбе пользователя или сам — по тому, что делает сценарий (сохранение формы — leave, reload, double; таблица — load; поля — matrix; запрос поиска — fuzz; вёрстка — layout).',
  ...QA_CHECKS.map((k) => `- ${k.id} — ${k.label}: ${k.hint}`),
  'Матрица (matrix) и перебор (fuzz) работают только со значениями: после pw_check задай их инструментом pw_check_values — не пиши свои списки вариантов в коде рядом. Матрица — значения, вводимые в поле (каждое — отдельный прогон сценария: подходит для поля поиска и форм); перебор — параметры запроса, который отправил сценарий (API).',
  'Смена контекста одним сценарием: действия → pw_check kind=context (запомнить поля) → допиши в сценарий переключение контекста (note_edit) → pw_check kind=compare.',
  'load и matrix меняют данные на сервере (строки, сохранения) — перед запуском скажи об этом пользователю. Сценарий пользователя правь бережно: его действия и локаторы — основа, меняй то, что падает.',
].join('\n')

/** Running: the guide to runnable notes, a run, its results, the browser. */
export function runTools(c: ToolCtx): McpTool[] {
  return [
    {
      name: 'qvarch_guide',
      access: 'read',
      description: 'Как писать исполняемые заметки Qvarch: блоки HTTP / JS-TS / Playwright / SQL / оболочка (PowerShell, cmd, bash — на ПК и по SSH) / текст по шаблону / данные, циклы, переменные {{ }}, флаги, отчёты, правила работы с серверами. Вызови перед созданием или правкой блоков.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => `${RUN_GUIDE}\n${CHECKS_GUIDE}`,
    },
    {
      name: 'note_run',
      access: 'run',
      description: 'Выполнить заметку: все блоки сверху вниз (как «Выполнить всё») или один исполняемый блок / цикл по имени (HTTP, код, Playwright, SQL, оболочка, текст по шаблону, цикл). Скрипт оболочки, изменённый тобой, пользователь сначала подтверждает в приложении. Ждёт конца и возвращает отчёт: статусы, шаги тестов, ошибки, результаты.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, block: { type: 'string', description: 'Имя блока или цикла (name=…); пусто — вся заметка' } }, required: ['path'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        return c.ui<string>('run', { path, block: opt(a.block) })
      },
    },
    {
      name: 'note_results',
      access: 'read',
      description:
        'Последние результаты заметки без запуска: отчёт по блокам и значения переменных. Если по заметке идёт прогон — сначала дожидается его конца (до 5 мин), поэтому опрашивать по кругу не нужно; результат своего note_run бери из его ответа.',
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
      name: 'pw_check_values',
      access: 'write',
      description: [
        'Значения готовой проверки сценария Playwright — как «Значения матрицы» и «Параметры перебора» у блока. Без них проверка ничего не перебирает.',
        'kind=matrix (после pw_check kind=matrix): fields — { "<f1 или имя поля из qa.fieldMatrix>": [{ label, value — строка как есть, или expr — выражение gen.text(255) / gen.email() / gen.int(1, 9) …, bad: true — форма должна отклонить }] }. Каждое значение — отдельный прогон сценария с этим значением в поле (остальные поля — как записаны). mode — query: поле поиска / фильтра (судить по запросу, в котором уходит значение: статус, сколько найдено); save: форма с сохранением; не дан — определится сам.',
        'kind=fuzz (после pw_check kind=fuzz): request — «GET /api/путь» (метод и путь без сайта и параметров), params — [{ path: "query.<имя>" или "body.<путь>", cases: [{ label, value — выражение: \'""\', \'null\', \'drop\' (без параметра), \'size(21)\' (массив из 21), \'gen.text(1000)\', \'"-1"\' }] }], found — где в ответе «сколько найдено» (meta.total…), можно не давать. Запрос, отправленный сценарием, повторяется с каждым значением.',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          block: { type: 'string', description: 'Имя блока Playwright (name=…)' },
          kind: { type: 'string', enum: ['matrix', 'fuzz'] },
          fields: { type: 'object', description: 'kind=matrix' },
          mode: { type: 'string', enum: [...MATRIX_MODES], description: 'kind=matrix: query — поиск / фильтр, save — форма с сохранением' },
          request: { type: 'string', description: 'kind=fuzz' },
          params: { type: 'array', description: 'kind=fuzz', items: { type: 'object' } },
          found: { type: 'string', description: 'kind=fuzz' },
        },
        required: ['path', 'block', 'kind'],
      },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        const values: CheckValues =
          a.kind === 'fuzz'
            ? { kind: 'fuzz', request: String(a.request ?? ''), params: Array.isArray(a.params) ? (a.params as FuzzParam[]) : [], ...(typeof a.found === 'string' ? { found: a.found } : {}) }
            : { kind: 'matrix', fields: a.fields && typeof a.fields === 'object' ? (a.fields as Record<string, MatrixValue[]>) : {}, ...(MATRIX_MODES.includes(a.mode as MatrixMode) ? { mode: a.mode as MatrixMode } : {}) }
        const r = checkValuesIn(await c.ui<string>('read', { path }), str(a.block, 'block', 120), values)
        if ('error' in r) throw new Error(r.error)
        await c.ui('write', { path, text: r.text })
        return `Значения проверки записаны в «${String(a.block)}» (${path}). Запуск — note_run.`
      },
    },
    {
      name: 'page_look',
      access: 'run',
      description:
        'Посмотреть страницу во встроенном браузере: что на ней можно нажать и заполнить, с готовыми локаторами (как пишет запись сценария) — не DOM, до 120 элементов. Вызывай сам, когда пишешь или правишь тест и не знаешь селекторов: не выдумывай их. Не нужно, если в записанном сценарии они уже есть. url — адрес страницы (из компонента «Браузер» в документе или из теста; вход — пользователя, тот же профиль браузера); пусто — страница, открытая у пользователя сейчас. Элементы, что появляются после действий (окна, шаги формы), — только когда это состояние открыто.',
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
