import type { NoteCommandId } from '../../commands/registry'
import { linkEdit, setHeading, toggleLines, toggleMark, wikiLinkEdit, type FormatEdit } from './formatEdits'

/**
 * The note's formatting toolbar as data: groups of buttons in one row; a few variants of one action — one button
 * with a menu (headings, lists, links). A button edits the text, runs an «@» command (a component inserted at the
 * cursor, a picture picked) or steps the history. `hideBelow` — hidden when the note's pane is narrower.
 */
export type ToolAction = { kind: 'edit'; edit: FormatEdit } | { kind: 'command'; id: NoteCommandId } | { kind: 'history'; dir: 'undo' | 'redo' }

export interface ToolItem {
  id: string
  icon: string
  title: string
  /** Its keys, said in the hint. */
  keys?: string
  action: ToolAction
}
export type ToolEntry = { kind: 'button'; item: ToolItem } | { kind: 'menu'; id: string; icon: string; title: string; items: ToolItem[] } | { kind: 'components' }
/** The pane's widths (px) under which a group hides: the less used first, the components' menu never. */
export const TOOLBAR_WIDTHS = [560, 420] as const
export type ToolbarWidth = (typeof TOOLBAR_WIDTHS)[number]
export interface ToolGroup {
  id: string
  entries: ToolEntry[]
  /** Hidden when the pane is narrower than this (the rest stays in one row). */
  hideBelow?: ToolbarWidth
}

const edit = (id: string, icon: string, title: string, e: FormatEdit, keys?: string): ToolItem => ({ id, icon, title, ...(keys ? { keys } : {}), action: { kind: 'edit', edit: e } })
const command = (id: NoteCommandId, icon: string, title: string): ToolItem => ({ id, icon, title, action: { kind: 'command', id } })
const button = (item: ToolItem): ToolEntry => ({ kind: 'button', item })

export const TOOLBAR: readonly ToolGroup[] = [
  {
    id: 'history',
    hideBelow: 560,
    entries: [
      button({ id: 'undo', icon: 'undo', title: 'Отменить', keys: 'Ctrl+Z', action: { kind: 'history', dir: 'undo' } }),
      button({ id: 'redo', icon: 'redo', title: 'Повторить', keys: 'Ctrl+Y', action: { kind: 'history', dir: 'redo' } }),
    ],
  },
  {
    id: 'heading',
    entries: [
      {
        kind: 'menu',
        id: 'heading',
        icon: 'heading',
        title: 'Заголовок',
        items: [edit('p', 'pilcrow', 'Обычный текст', setHeading(0)), ...[1, 2, 3, 4].map((n) => edit(`h${n}`, `heading${n}`, `Заголовок ${n}`, setHeading(n)))],
      },
    ],
  },
  {
    id: 'inline',
    entries: [
      button(edit('bold', 'bold', 'Жирный', toggleMark('bold'), 'Ctrl+B')),
      button(edit('italic', 'italic', 'Курсив', toggleMark('italic'), 'Ctrl+I')),
      button(edit('strike', 'strike', 'Зачёркнутый', toggleMark('strike'))),
      button(edit('code', 'code', 'Код в строке', toggleMark('code'))),
    ],
  },
  {
    id: 'lines',
    hideBelow: 420,
    entries: [
      {
        kind: 'menu',
        id: 'list',
        icon: 'list',
        title: 'Список',
        items: [edit('bullet', 'list', 'Маркированный список', toggleLines('bullet')), edit('ordered', 'listOrdered', 'Нумерованный список', toggleLines('ordered')), edit('task', 'checkSquare', 'Чек-лист', toggleLines('task'))],
      },
      button(edit('quote', 'quote', 'Цитата', toggleLines('quote'))),
    ],
  },
  {
    id: 'insert',
    hideBelow: 420,
    entries: [
      { kind: 'menu', id: 'link', icon: 'link', title: 'Ссылка', items: [edit('link', 'globe', 'Ссылка на сайт', linkEdit), edit('wiki', 'note', 'Ссылка на заметку  [[…]]', wikiLinkEdit)] },
      button(command('image', 'image', 'Изображение')),
      button(command('table', 'table', 'Таблица')),
    ],
  },
  {
    id: 'blocks',
    hideBelow: 560,
    entries: [button(command('code', 'squareCode', 'Блок кода')), button(command('divider', 'minus', 'Разделитель')), button(command('emoji', 'smilePlus', 'Эмодзи'))],
  },
  { id: 'components', entries: [{ kind: 'components' }] },
]

/** The groups of the components' menu (every «@» command in one — the compiler checks). */
export const COMPONENT_GROUPS = ['text', 'data', 'run', 'media'] as const
export type ComponentGroup = (typeof COMPONENT_GROUPS)[number]
export const COMPONENT_GROUP_TITLE: Record<ComponentGroup, string> = { text: 'Текст и оформление', data: 'Данные', run: 'Запросы и проверки', media: 'Медиа и общение' }
export const COMPONENT_GROUP_OF: Record<NoteCommandId, ComponentGroup> = {
  callout: 'text',
  toggle: 'text',
  toc: 'text',
  todo: 'text',
  code: 'text',
  divider: 'text',
  date: 'text',
  emoji: 'text',
  mermaid: 'text',
  table: 'data',
  chart: 'data',
  data: 'data',
  ref: 'data',
  tpl: 'data',
  work: 'data',
  http: 'run',
  sql: 'run',
  pw: 'run',
  js: 'run',
  shell: 'run',
  loop: 'run',
  fuzz: 'run',
  files: 'run',
  regress: 'run',
  browser: 'run',
  save: 'run',
  cron: 'run',
  image: 'media',
  audio: 'media',
  board: 'media',
  chat: 'media',
}
