/**
 * What «@» offers in a note before the events: things to insert and do (as Notion's «/»). Each one is found by
 * the start of any of its words, Russian or English — «ауд», «aud», «запис» all find «Аудио».
 */
export type CmdId = 'http' | 'pw' | 'browser' | 'js' | 'data' | 'ref' | 'work' | 'board' | 'audio' | 'emoji' | 'table' | 'chart' | 'mermaid' | 'callout' | 'toggle' | 'toc' | 'image' | 'todo' | 'code' | 'divider' | 'date' | 'regress' | 'files' | 'fuzz' | 'sql' | 'loop' | 'tpl'
export interface NoteCmd {
  id: CmdId
  title: string
  hint: string
  icon: string
  keys: string[]
}
export const NOTE_CMDS: NoteCmd[] = [
  { id: 'audio', title: 'Аудио', hint: 'Записать голос в заметку — запись начнётся сразу', icon: 'mic', keys: ['аудио', 'audio', 'голос', 'voice', 'запись', 'record', 'диктовка'] },
  { id: 'emoji', title: 'Эмодзи', hint: 'Выбрать эмодзи — пишите название по-русски или по-английски', icon: 'sparkles', keys: ['эмодзи', 'эмоджи', 'emoji', 'смайл', 'smile', 'smiley'] },
  { id: 'http', title: 'HTTP-запрос', hint: 'Выполняется здесь; ответ доступен дальше по имени — {{имя.body}}', icon: 'api', keys: ['http', 'запрос', 'request', 'api', 'rest', 'curl', 'get', 'post'] },
  { id: 'pw', title: 'Playwright', hint: 'Сценарий в браузере (Edge / Chrome): шаги, скриншот, трассировка, Allure', icon: 'globe', keys: ['playwright', 'браузер', 'автотест', 'тест', 'e2e', 'сценарий', 'browser', 'test', 'ui'] },
  { id: 'sql', title: 'Запрос к БД', hint: 'SQL к PostgreSQL / MySQL / SQLite: только чтение, соединение на каждый запрос; строки — в переменную блока, план запроса с узкими местами; запросы всего блокнота — библиотекой', icon: 'database', keys: ['бд', 'db', 'sql', 'база', 'база данных', 'запрос', 'select', 'postgres', 'postgresql', 'mysql', 'sqlite', 'explain', 'план'] },
  { id: 'fuzz', title: 'Перебор параметров запроса', hint: 'Запрос сайта (поиск, фильтр, выгрузка) с перебором параметров: массивы 0 / 1 / 20 / 21 / 100, пусто, null, длинные строки, числа. Таблица: статус, время, сколько найдено; где ломается', icon: 'api', keys: ['перебор', 'fuzz', 'фаззинг', 'параметры', 'запрос', 'граница', 'массив', 'фильтр', 'api'] },
  { id: 'files', title: 'Тестовые файлы', hint: 'Набор файлов для сценариев с загрузкой: свои, записанные, сгенерированные; у каждого — принять / отклонить. Сценарий прогоняется по всему набору', icon: 'folder', keys: ['файлы', 'файл', 'загрузка', 'импорт', 'excel', 'xlsx', 'csv', 'upload', 'files', 'тестовые'] },
  { id: 'regress', title: 'Регрессия', hint: 'Прогнать все тесты Playwright папки: таблица результатов, история по датам, запуск на другом адресе', icon: 'repeat', keys: ['регрессия', 'regression', 'прогон', 'тесты', 'tests', 'suite', 'набор', 'автотесты'] },
  { id: 'browser', title: 'Браузер', hint: 'Живые страницы во вкладках прямо в заметке; запросы и время загрузки', icon: 'browser', keys: ['браузер', 'browser', 'сайт', 'страница', 'web', 'вкладка', 'запросы', 'network', 'iframe'] },
  { id: 'loop', title: 'Цикл', hint: 'Повторить блоки для каждого элемента: заголовок — обычный JS (for…of, for…in, Object.entries, while), await body({ … }) — проход; результаты — по одному, вместе (одна таблица / один текст) или каждый отдельно', icon: 'repeat', keys: ['цикл', 'loop', 'for', 'foreach', 'each', 'while', 'повтор', 'перебор', 'итерация', 'каждый'] },
  { id: 'tpl', title: 'Текст по шаблону', hint: 'Markdown с {{ значениями }}: эмодзи, жирный, списки, таблицы — заполняется данными и копируется с оформлением; в цикле — текст на каждый проход', icon: 'note', keys: ['шаблон', 'template', 'текст', 'text', 'сообщение', 'message', 'markdown', 'отчёт'] },
  { id: 'js', title: 'Код JS / TS', hint: 'Выполняется отдельно от приложения; переменные заметки — его переменные, return — результат', icon: 'code', keys: ['код', 'js', 'ts', 'javascript', 'typescript', 'скрипт', 'script', 'run', 'выполнить', 'функция'] },
  { id: 'data', title: 'Данные JSON', hint: 'Набор данных с именем — для кода и запросов', icon: 'braces', keys: ['данные', 'data', 'json', 'yaml', 'массив', 'array', 'переменная', 'variable'] },
  { id: 'ref', title: 'Значение переменной', hint: 'Показывает значение из контекста заметки — вживую', icon: 'eye', keys: ['значение', 'value', 'ref', 'вывод', 'output', 'показать'] },
  { id: 'work', title: 'Работа', hint: 'Вся работа за день или период: по дням, итог по видам и всего', icon: 'briefcase', keys: ['работа', 'work', 'отчёт', 'отчет', 'report', 'таймшит', 'timesheet', 'часы', 'hours'] },
  { id: 'board', title: 'Доска', hint: 'Показать доску из блокнота — всегда в актуальном виде; «Снимок» — картинкой', icon: 'presentation', keys: ['доска', 'board', 'whiteboard', 'рисунок', 'холст', 'canvas'] },
  { id: 'table', title: 'Таблица', hint: 'Таблица — выберите размер', icon: 'table', keys: ['таблица', 'table', 'grid', 'сетка'] },
  { id: 'chart', title: 'График', hint: 'Столбцы, линии, области или круговая — по своей таблице данных', icon: 'chart', keys: ['график', 'диаграмма', 'chart', 'graph', 'plot'] },
  { id: 'mermaid', title: 'Схема', hint: 'Блок-схема, последовательность, состояния, ER, Gantt (Mermaid)', icon: 'branch', keys: ['схема', 'mermaid', 'flowchart', 'диаграмма', 'diagram', 'sequence', 'блок-схема'] },
  { id: 'callout', title: 'Выноска', hint: 'Цветной блок: информация, совет, внимание, опасно, готово', icon: 'bell', keys: ['выноска', 'callout', 'внимание', 'совет', 'инфо', 'info', 'warning', 'note', 'tip', 'admonition'] },
  { id: 'toggle', title: 'Свёртка', hint: 'Заголовок, который раскрывает скрытый текст', icon: 'chevronRight', keys: ['свёртка', 'свертка', 'toggle', 'details', 'раскрывающийся', 'спойлер', 'spoiler', 'collapse'] },
  { id: 'toc', title: 'Оглавление', hint: 'Список заголовков заметки — клик ведёт к разделу', icon: 'list', keys: ['оглавление', 'содержание', 'toc', 'contents'] },
  { id: 'image', title: 'Изображение', hint: 'Вставить картинку из файла', icon: 'image', keys: ['изображение', 'картинка', 'фото', 'image', 'picture', 'img', 'photo'] },
  { id: 'todo', title: 'Чек-лист', hint: 'Пункт с галочкой', icon: 'checkSquare', keys: ['чек-лист', 'чеклист', 'задача', 'todo', 'checkbox', 'checklist', 'галочка'] },
  { id: 'code', title: 'Код', hint: 'Блок кода с подсветкой и форматированием', icon: 'code', keys: ['код', 'code', 'snippet', 'sql', 'json'] },
  { id: 'divider', title: 'Разделитель', hint: 'Горизонтальная линия', icon: 'rows', keys: ['разделитель', 'линия', 'divider', 'hr', 'line', 'separator'] },
  { id: 'date', title: 'Дата', hint: 'Сегодняшняя дата', icon: 'calendar', keys: ['дата', 'сегодня', 'date', 'today', 'now'] },
]
/** The commands a query names (all of them for an empty one). */
export function matchCmds(query: string): NoteCmd[] {
  const q = query.trim().toLowerCase()
  if (!q) return NOTE_CMDS
  return NOTE_CMDS.filter((c) => c.keys.some((k) => k.startsWith(q)) || c.title.toLowerCase().startsWith(q))
}
/**
 * The picker turned into a picker of its own: «@эмодзи сердце» / «@emoji heart» — emoji (any one of the
 * words is enough), «@таблица» / «@table 3x4» — a table's size.
 */
export function pickerMode(query: string): { mode: 'emoji'; q: string } | { mode: 'table'; c?: number; r?: number } | { mode: 'board'; q: string } | undefined {
  const b = /^(доска|доски|board|boards)(?:\s+(.*))?$/i.exec(query)
  if (b) return { mode: 'board', q: (b[2] ?? '').trim() }
  const e = /^(эмодзи|эмоджи|emoji|смайлы|смайлики|smileys?)(?:\s+(.*))?$/i.exec(query)
  if (e) return { mode: 'emoji', q: (e[2] ?? '').trim() }
  const t = /^(таблица|table)(?:\s+(\d{1,2})\s*[x×х*]\s*(\d{1,3}))?\s*$/i.exec(query)
  if (t) return { mode: 'table', c: t[2] ? Number(t[2]) : undefined, r: t[3] ? Number(t[3]) : undefined }
  return undefined
}
