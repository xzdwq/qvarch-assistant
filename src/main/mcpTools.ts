import { findBlocks } from '../notebook/domain/findBlocks'
import { fencedBlocksOf } from '../notebook/domain/noteBlocks'
import { findLoops } from '../notebook/domain/loop'
import { BLOCK_SPECS } from '../notebook/blocks/specs'
import { dayKey, MINUTE } from '../shared/timeline'
import type { Entry, DayData } from '../shared/types'
import type { JiraIssue } from '../shared/jira'
import type { VaultNode } from '../shared/vault'
import { hostAllowed, type McpTool } from './mcp'

/**
 * The tools Qvarch gives an AI assistant. Reading and running — always; writing notes and keeping the time —
 * allowed beforehand (the user's choice); tests against hosts off the allowed list (*-dev, *-qa…) — the user is
 * asked, with a warning. Time is never deleted or moved — only created and extended.
 */
export interface ToolCtx {
  tree: () => VaultNode[]
  mkdir: (dir: string, name: string) => string
  issue: (key: string) => JiraIssue | undefined
  findIssues: (q: string) => JiraIssue[]
  day: (day: string) => DayData
  saveEntry: (day: string, input: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }) => Entry
  openInBrowser: (url: string) => void
  /** The app's window does it (the notes live there): read, write, create, run, report, refresh. */
  ui: <T>(op: string, args: Record<string, unknown>) => Promise<T>
  allow: () => string[]
  /** Hosts off the list: the user says yes or no. */
  confirmHosts: (hosts: string[], note: string) => Promise<boolean>
}

const str = (v: unknown, name: string, max = 500_000) => {
  if (typeof v !== 'string' || !v.length) throw new Error(`Нужен параметр ${name}`)
  return v.slice(0, max)
}
const opt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const notePath = (p: string) => (p.toLowerCase().endsWith('.md') ? p : `${p}.md`).replace(/^\/+/, '')

function flat(nodes: VaultNode[], under = ''): Array<{ path: string; dir: boolean; board: boolean }> {
  const out: Array<{ path: string; dir: boolean; board: boolean }> = []
  const walk = (ns: VaultNode[]) => {
    for (const n of ns) {
      if (!under || n.path === under || n.path.startsWith(`${under}/`)) out.push({ path: n.path, dir: n.dir, board: !!n.board })
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}
/** The hosts a note talks to (any http(s) address in it — its data, its requests, its tests). */
function hostsOf(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+(?::\d+)?)/gi)) out.add(m[1].toLowerCase().replace(/:\d+$/, ''))
  return [...out]
}
/** Every block of a note for the assistant: its kind, its name (a fenced block's name=, a loop's name=), its line, flags. */
function blocksOf(text: string): Array<{ kind: string; title: string; name?: string; line: number; lib?: boolean; soft?: boolean; runnable?: boolean }> {
  const fenced = new Map(fencedBlocksOf(text).map((b) => [b.line0, b]))
  const loops = new Map(findLoops(text.split('\n')).map((l) => [l.line0, l]))
  return findBlocks(text.split('\n')).map((b) => {
    const spec = BLOCK_SPECS[b.kind]
    const info = fenced.get(b.line0)?.info
    const loop = loops.get(b.line0)
    return {
      kind: b.kind,
      title: spec.title,
      name: info?.name ?? loop?.info.name,
      line: b.line0,
      lib: info?.lib || undefined,
      soft: info?.soft || loop?.info.soft || undefined,
      runnable: (!!spec.runnable && !info?.lib) || (b.kind === 'loop' && loop?.end !== undefined) || undefined,
    }
  })
}

export function qvarchTools(c: ToolCtx): McpTool[] {
  const approved = new Set<string>()
  /** A run's hosts checked: the allowed ones go, the others — the user is asked (once per host and app run). */
  async function guardHosts(text: string, what: string): Promise<void> {
    const bad = hostsOf(text).filter((h) => !hostAllowed(h, c.allow()) && !approved.has(h))
    if (!bad.length) return
    if (!(await c.confirmHosts(bad, what))) throw new Error(`Пользователь не разрешил запуск против ${bad.join(', ')} — эти адреса не в списке разрешённых (Настройки → AI-ассистенты). Предложи стенд *-dev / *-qa или спроси пользователя.`)
    for (const h of bad) approved.add(h)
  }

  return [
    {
      name: 'qvarch_guide',
      description: 'Как писать исполняемые заметки Qvarch: блоки HTTP / JS-TS / Playwright / SQL / текст по шаблону / данные, циклы, переменные {{ }}, флаги, отчёты. Вызови перед созданием или правкой блоков.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => GUIDE,
    },
    {
      name: 'notes_list',
      description: 'Список папок и заметок блокнота (пути). folder — показать только эту папку.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Путь папки, например «ABC-123 Статусы»' } } },
      run: async (a) => {
        const list = flat(c.tree(), opt(a.folder) ?? '')
        return list.length ? list.map((x) => `${x.dir ? '📁' : x.board ? '🧩' : '📄'} ${x.path}`).join('\n') : 'Пусто'
      },
    },
    {
      name: 'task_folder',
      description: 'Папка задачи: находит папку, чьё имя начинается с ключа задачи (ABC-123), иначе создаёт «КЛЮЧ — название из Jira». Все тесты и документы по задаче — в ней.',
      inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Ключ задачи Jira, например ABC-42' }, title: { type: 'string', description: 'Название, если задачи нет в Jira' } }, required: ['key'] },
      run: async (a) => {
        const key = str(a.key, 'key', 50).trim().toUpperCase()
        const dirs = flat(c.tree()).filter((x) => x.dir)
        const found = dirs.find((d) => (d.path.split('/').pop() ?? '').toUpperCase().startsWith(key))
        if (found) {
          const inside = flat(c.tree(), found.path).filter((x) => x.path !== found.path)
          return `Папка есть: ${found.path}\n${inside.map((x) => `  ${x.dir ? '📁' : '📄'} ${x.path}`).join('\n') || '  (пустая)'}`
        }
        const issue = c.issue(key)
        const title = opt(a.title) ?? issue?.summary ?? ''
        const name = `${key}${title ? ` — ${title}` : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120).trim()
        const path = c.mkdir('', name)
        await c.ui('refresh', {})
        return `Создана папка: ${path}${issue ? `\nЗадача: ${issue.summary} (${issue.status})` : '\n(в Jira-кэше задачи нет)'}`
      },
    },
    {
      name: 'note_read',
      description: 'Текст заметки (Markdown с блоками) и список её блоков (вид, имя, строка).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        const text = await c.ui<string>('read', { path })
        const bl = blocksOf(text)
        return `${text}\n\n---\nБлоки: ${bl.length ? bl.map((b) => `${b.kind} (${b.title})${b.name ? ` «${b.name}»` : ''} (строка ${b.line}${b.runnable ? ', выполняется' : ''}${b.lib ? ', lib' : ''}${b.soft ? ', soft' : ''})`).join('; ') : 'нет'}`
      },
    },
    {
      name: 'note_create',
      description: 'Новая заметка в папке (свободное имя). Текст — Markdown с блоками (см. qvarch_guide). Возвращает путь.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Папка ("" — корень)' }, name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'] },
      run: async (a) => {
        const path = await c.ui<string>('create', { dir: opt(a.folder) ?? '', name: str(a.name, 'name', 150), text: str(a.text, 'text') })
        return `Создана: ${path}`
      },
    },
    {
      name: 'note_write',
      description: 'Записать заметку целиком (существующую — заменить текст; новой по этому пути — создать).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        await c.ui('write', { path, text: str(a.text, 'text') })
        return `Записано: ${path}`
      },
    },
    {
      name: 'note_edit',
      description: 'Точечная правка: заменить фрагмент find на replace (find должен встречаться ровно один раз), или append — дописать в конец.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, append: { type: 'string' } }, required: ['path'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        let text = await c.ui<string>('read', { path })
        if (typeof a.find === 'string' && a.find) {
          const n = text.split(a.find).length - 1
          if (n !== 1) throw new Error(n ? `Фрагмент встречается ${n} раз — уточни find` : 'Фрагмент find не найден — прочитай заметку заново (note_read)')
          text = text.replace(a.find, String(a.replace ?? ''))
        }
        if (typeof a.append === 'string' && a.append) text = `${text.replace(/\n*$/, '')}\n\n${a.append}\n`
        await c.ui('write', { path, text })
        return `Изменено: ${path}`
      },
    },
    {
      name: 'data_set',
      description: 'Мок-данные / настройки в заметку: блок данных с именем name (```json name=…) — заменяет значение, если такой есть, иначе добавляет блок (после заголовка «## Данные», если он есть, иначе в конец). Значение доступно другим блокам как переменная.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, name: { type: 'string', description: 'Имя переменной (латиница)' }, value: { description: 'Любое JSON-значение' } }, required: ['path', 'name', 'value'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        const name = str(a.name, 'name', 60)
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('name — латиница, цифры, _ (не с цифры)')
        const body = JSON.stringify(a.value, null, 2)
        const text = await c.ui<string>('read', { path })
        const lines = text.split('\n')
        const b = fencedBlocksOf(text).find((x) => x.kind === 'data' && x.info.name === name)
        let next: string
        if (b) {
          lines.splice(b.line0, b.line1 - b.line0 - 1, ...body.split('\n'))
          next = lines.join('\n')
        } else {
          const block = `\`\`\`json name=${name}\n${body}\n\`\`\``
          const h = lines.findIndex((l) => /^#{2,3}\s+(данные|мок|mock|data)/i.test(l))
          if (h >= 0) {
            lines.splice(h + 1, 0, '', block)
            next = lines.join('\n')
          } else next = `${text.replace(/\n*$/, '')}\n\n${block}\n`
        }
        await c.ui('write', { path, text: next })
        return `${b ? 'Обновлён' : 'Добавлен'} блок данных «${name}» в ${path}`
      },
    },
    {
      name: 'note_run',
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
      description: 'Последние результаты заметки без запуска: отчёт по блокам и значения переменных.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async (a) => c.ui<string>('report', { path: notePath(str(a.path, 'path', 1000)) }),
    },
    {
      name: 'jira_issue',
      description: 'Задача Jira из кэша Qvarch: название, статус, тип, исполнитель, описание (Markdown). Без ключа — поиск по тексту.',
      inputSchema: { type: 'object', properties: { key: { type: 'string' }, query: { type: 'string', description: 'Поиск по названию / описанию' } } },
      run: async (a) => {
        const key = opt(a.key)?.toUpperCase()
        if (key) {
          const i = c.issue(key)
          if (!i) return `Задачи ${key} нет в кэше Qvarch (синхронизация Jira в «Моей работе»).`
          return [`${i.key} — ${i.summary}`, `Статус: ${i.status} · ${i.type}${i.priority ? ` · ${i.priority}` : ''}${i.assignee ? ` · ${i.assignee}` : ''}${i.due ? ` · срок ${i.due}` : ''}`, i.labels?.length ? `Метки: ${i.labels.join(', ')}` : '', '', i.description ?? '(без описания)'].filter((x) => x !== '').join('\n')
        }
        const q = opt(a.query)
        if (!q) throw new Error('Нужен key или query')
        const list = c.findIssues(q)
        return list.length ? list.map((i) => `${i.key} — ${i.summary} (${i.status})`).join('\n') : 'Ничего не найдено'
      },
    },
    {
      name: 'work_today',
      description: 'Записи времени «Моей работы» за сегодня (или за день YYYY-MM-DD).',
      inputSchema: { type: 'object', properties: { day: { type: 'string' } } },
      run: async (a) => {
        const day = opt(a.day) ?? dayKey(Date.now())
        const es = [...c.day(day).entries].sort((x, y) => x.start - y.start)
        const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        return es.length ? es.map((e) => `${hm(e.start)}–${hm(e.end)} ${e.label}${e.task ? ` [${e.task.key}]` : ''}${e.outlook ? ' (Outlook)' : ''}`).join('\n') : `${day}: записей нет`
      },
    },
    {
      name: 'work_track',
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
        const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
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
    {
      name: 'browser_open',
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

const GUIDE = `# Исполняемые заметки Qvarch — как писать

Заметка — Markdown. Исполняемые блоки — fenced-блоки с информационной строкой. Всё, что блок вернул, публикуется в контекст заметки под его именем (name=…) и доступно:
- в тексте и в HTTP-запросах: {{ имя.путь }} — например {{ user.body.email }}, {{ items.length }}, {{ resp.headers["content-type"] }};
- в коде (JS/TS, Playwright) — как обычная переменная (user.body.email).
Блоки выполняются сверху вниз («Выполнить всё» / note_run); первая ошибка останавливает прогон, кроме блоков с флагом soft.

## Данные
\`\`\`json name=config
{ "base": "https://app.example.com", "user": "test" }
\`\`\`
(или yaml name=…). Публикуется сразу. Мок-данные удобно класть через data_set.

## HTTP (формат .http — JetBrains / REST Client)
\`\`\`http name=login
POST {{ config.base }}/api/auth/login
Content-Type: application/json

{"email": "{{ config.user }}", "password": "{{ secret }}"}
\`\`\`
Результат: login = { status, ok, statusText, headers (нижний регистр), body (JSON распарсен), time (мс), size, url }.

## Код JS / TS (в отдельном процессе Node)
\`\`\`ts run name=checks
const list = []
list.push({ name: 'статус 200', ok: login.status === 200 })
console.log('проверок', list.length)
set('token', login.body.data.access_token)   // опубликовать ещё переменную
return { passed: list.filter(c => c.ok).length, list }
\`\`\`
- TS — типы просто вырезаются. Есть fetch, URL, setTimeout, console.*.
- return — результат под именем блока; set('имя', значение) — ещё переменные.
- Флаг lib (\`\`\`ts lib) — общие функции: не выполняется сам, подставляется перед каждым блоком кода и Playwright.
- runs — состояние всех блоков заметки ({ имя: { kind, state: 'ok'|'error'|'none', ms, error, status, steps, soft } }) — для отчёта в конце.
- timeout=120 — лимит секунд (по умолчанию 30).

## Playwright (установленный Edge / Chrome)
\`\`\`ts playwright name=createItem session
await step('Открыть страницу', async () => {
  await page.goto(\`\${config.base}/items\`)
  await expect(page.getByRole('button', { name: 'Создать' })).toBeVisible({ timeout: 30_000 })
})
await step('Создать', async () => {
  await page.getByRole('button', { name: 'Создать' }).click()
  await page.locator('.q-menu .q-item', { hasText: 'Новая запись' }).click()
})
return { url: page.url() }
\`\`\`
- Доступно: page, context, browser, expect (из @playwright/test), devices, step(имя, fn) — шаги видны в отчёте и трассировке, set(), console, переменные заметки, runs.
- Флаги: session — войти как пользователь во встроенном браузере Qvarch (его cookies, в том числе SSO/ADFS) — ставь для внутренних систем; headed — показать окно; notrace — без трассировки; browser=chrome; soft — ошибка ожидаема и не останавливает прогон; timeout=… (по умолчанию 120).
- Локаторы: предпочитай getByRole(роль, { name }) / getByLabel / getByPlaceholder / getByText / getByTestId. Меню и списки Quasar рисуются в <body>: page.locator('.q-menu .q-item', { hasText: '…' }). Иконочные кнопки Quasar: .q-btn с <i> где текст иконки ровно 'add'.
- Ждать по признакам (expect(...).toBeVisible/toBeEnabled, page.waitForResponse), не таймерами.
- Не сохраняй и не удаляй данные на стенде без прямой просьбы пользователя.
- После прогона есть скриншот, трассировка (Trace Viewer) и Allure-результаты.

## Запрос к БД (только чтение)
\`\`\`sql db=main name=rows
select id, status from orders where customer_id = {{ user.body.id }}
\`\`\`
- db — имя подключения из «Базы данных» (настройки там, не в заметке); значения {{ }} уходят параметрами, а не текстом.
- Результат: rows = массив объектов ({{ rows[0].status }}, rows.length).

## Текст по шаблону
\`\`\`md template name=summary
✅ **{{ user.body.email }}** — заказов: {{ rows.length }}
\`\`\`
Markdown с {{ значениями }}; публикуется заполненным под своим именем. Нет значения — ошибка блока.

## Цикл
<!-- qa:loop name=answers parallel=1 -->
\`\`\`js loop
for (const u of users) await body({ u })
\`\`\`
\`\`\`http name=user
GET {{ config.base }}/users/{{ u.id }}
\`\`\`
<!-- /qa:loop -->
- Заголовок — обычный JS; body({ … }) — один проход, его значения — переменные блоков внутри.
- После цикла имя каждого блока внутри — массив его значений по проходам (user[0].status), имя цикла — записи проходов (или то, что вернул заголовок).
- parallel=N — проходов одновременно (с Playwright внутри — всегда по одному), max=… — предел проходов, timeout=… — секунд на весь цикл, soft.
- note_run(path, block: "answers") — выполнить один цикл.

## Другие компоненты (не выполняются)
Таблица (GFM), \`\`\`chart, \`\`\`mermaid, \`\`\`toc, выноска > [!info], <details> свёртка, \`\`\`work, \`\`\`board, \`\`\`browser, \`\`\`regress, \`\`\`files — видны в списке блоков note_read.

## Значение из контекста
\`\`\`json ref=checks.list
\`\`\`

## Как работать с задачей
1. jira_issue(key) — прочитай задачу (описание, критерии).
2. task_folder(key) — папка задачи (создастся, если нет); все документы и тесты — в ней. Новые тесты — новые заметки в этой папке, существующие — дополняй.
3. work_track(key) — отметь время; вызывай снова по ходу работы (продлит запись).
4. Заметка: заголовок, описание что проверяем, ## Данные (config, моки), блоки HTTP / кода / Playwright с понятными именами и step(), в конце блок отчёта (\`\`\`ts run name=report\`\`\`, собирает итог из runs) и текст «## Заключение».
5. note_run(path) → прочитай отчёт → исправь упавшее (локаторы, ожидания) → снова note_run.
6. Напиши заключение в заметку (note_edit append): что проверено, что прошло, что упало и почему, что осталось.
`
