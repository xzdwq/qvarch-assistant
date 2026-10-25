/** How runnable notes are written — what the `qvarch_guide` tool tells an agent. */
export const RUN_GUIDE = `# Исполняемые заметки Qvarch — как писать

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
