/**
 * What «@» offers in a note before the events: things to insert and do (as Notion's «/»). Each one is found by
 * the start of any of its words, Russian or English — «ауд», «aud», «запис» all find «Аудио».
 */
export type CmdId = 'work' | 'board' | 'audio' | 'emoji' | 'table' | 'chart' | 'mermaid' | 'callout' | 'toggle' | 'toc' | 'image' | 'todo' | 'code' | 'divider' | 'date'
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
