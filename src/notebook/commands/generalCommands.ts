import type { NoteCommand } from './command'

/** The «@» commands that are not a block kind's: plain Markdown and the sub-menus of their own. */
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export const emojiCommand: NoteCommand = {
  id: 'emoji',
  title: 'Эмодзи',
  hint: 'Выбрать эмодзи — пишите название по-русски или по-английски',
  icon: 'sparkles',
  keys: ['эмодзи', 'эмоджи', 'emoji', 'смайл', 'smile', 'smiley'],
  run: (c) => ({ kind: 'insertText', text: c.latin ? '@emoji ' : '@эмодзи ', keepMenu: true }),
}
export const todoCommand: NoteCommand = {
  id: 'todo',
  title: 'Чек-лист',
  hint: 'Пункт с галочкой',
  icon: 'checkSquare',
  keys: ['чек-лист', 'чеклист', 'задача', 'todo', 'checkbox', 'checklist', 'галочка'],
  run: () => ({ kind: 'insertText', text: '- [ ] ' }),
}
export const codeFenceCommand: NoteCommand = {
  id: 'code',
  title: 'Код',
  hint: 'Блок кода с подсветкой и форматированием',
  icon: 'code',
  keys: ['код', 'code', 'snippet', 'sql', 'json'],
  run: () => ({ kind: 'insertText', text: '```', complete: true }),
}
export const dividerCommand: NoteCommand = {
  id: 'divider',
  title: 'Разделитель',
  hint: 'Горизонтальная линия',
  icon: 'rows',
  keys: ['разделитель', 'линия', 'divider', 'hr', 'line', 'separator'],
  run: () => ({ kind: 'insertBlock', markdown: '---' }),
}
export const dateCommand: NoteCommand = {
  id: 'date',
  title: 'Дата',
  hint: 'Сегодняшняя дата',
  icon: 'calendar',
  keys: ['дата', 'сегодня', 'date', 'today', 'now'],
  run: (c) => {
    const d = c.now()
    return { kind: 'insertText', text: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ` }
  },
}
