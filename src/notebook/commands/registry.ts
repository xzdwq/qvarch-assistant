import { ALL_BLOCK_SPECS } from '../blocks/specs'
import type { NoteCommand } from './command'
import { codeFenceCommand, dateCommand, dividerCommand, emojiCommand, todoCommand } from './generalCommands'

/**
 * The «@» menu: every command — the block kinds' own (from their specs) and the general ones — in the menu's
 * order. Each is found by the start of any of its words, Russian or English («ауд», «aud», «запис» → «Аудио»).
 */
const BY_ID = new Map<string, NoteCommand>([...ALL_BLOCK_SPECS.flatMap((s) => s.commands ?? []), emojiCommand, todoCommand, codeFenceCommand, dividerCommand, dateCommand].map((c) => [c.id, c]))

/** The menu's order (ids; every command once — checked by a test). */
export const MENU_ORDER = ['audio', 'emoji', 'http', 'pw', 'sql', 'fuzz', 'files', 'regress', 'browser', 'loop', 'tpl', 'js', 'data', 'ref', 'work', 'board', 'table', 'chart', 'mermaid', 'callout', 'toggle', 'toc', 'image', 'todo', 'code', 'divider', 'date'] as const

/** Every «@» command in the menu's order. */
export const NOTE_COMMANDS: readonly NoteCommand[] = MENU_ORDER.map((id) => {
  const c = BY_ID.get(id)
  if (!c) throw new Error(`«@»: no command «${id}»`)
  return c
})
/** Commands registered but missing from the menu's order (a test keeps this empty). */
export const unorderedCommandIds = () => [...BY_ID.keys()].filter((id) => !(MENU_ORDER as readonly string[]).includes(id))

/** The commands a query names (all of them for an empty one). */
export function matchCommands(query: string): readonly NoteCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return NOTE_COMMANDS
  return NOTE_COMMANDS.filter((c) => c.keys.some((k) => k.startsWith(q)) || c.title.toLowerCase().startsWith(q))
}

/** A sub-menu of «@»: emoji, a table's size, the notebook's boards. */
export type PickerMode = { mode: 'emoji'; q: string } | { mode: 'table'; c?: number; r?: number } | { mode: 'board'; q: string }
/**
 * The menu turned into a sub-menu by its keyword: «@эмодзи сердце» / «@emoji heart» — emoji (any one of the
 * words is enough), «@таблица» / «@table 3x4» — a table's size, «@доска …» — boards.
 */
export function pickerMode(query: string): PickerMode | undefined {
  const b = /^(доска|доски|board|boards)(?:\s+(.*))?$/i.exec(query)
  if (b) return { mode: 'board', q: (b[2] ?? '').trim() }
  const e = /^(эмодзи|эмоджи|emoji|смайлы|смайлики|smileys?)(?:\s+(.*))?$/i.exec(query)
  if (e) return { mode: 'emoji', q: (e[2] ?? '').trim() }
  const t = /^(таблица|table)(?:\s+(\d{1,2})\s*[x×х*]\s*(\d{1,3}))?\s*$/i.exec(query)
  if (t) return { mode: 'table', c: t[2] ? Number(t[2]) : undefined, r: t[3] ? Number(t[3]) : undefined }
  return undefined
}
