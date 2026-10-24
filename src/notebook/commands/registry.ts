import { ALL_BLOCK_SPECS } from '../blocks/specs'
import type { NoteCommand } from './command'
import { codeFenceCommand, dateCommand, dividerCommand, emojiCommand, todoCommand } from './generalCommands'

/**
 * The «@» menu: every command — the block kinds' own (from their specs) and the general ones — in the menu's
 * order. Each is found by its words, Russian or English, and synonyms («ауд», «aud», «запис» → «Аудио»; «curl» → HTTP);
 * some take what they are about right in the query («@get https://…» — a request to that address).
 */
const BY_ID = new Map<string, NoteCommand>([...ALL_BLOCK_SPECS.flatMap((s) => s.commands ?? []), emojiCommand, todoCommand, codeFenceCommand, dividerCommand, dateCommand].map((c) => [c.id, c]))

/** The menu's order (ids; every command once — checked by a test). */
export const MENU_ORDER = ['audio', 'emoji', 'http', 'pw', 'sql', 'fuzz', 'files', 'regress', 'browser', 'loop', 'tpl', 'js', 'data', 'ref', 'work', 'board', 'chat', 'table', 'chart', 'mermaid', 'callout', 'toggle', 'toc', 'image', 'todo', 'code', 'divider', 'date'] as const

/** Every «@» command in the menu's order. */
export const NOTE_COMMANDS: readonly NoteCommand[] = MENU_ORDER.map((id) => {
  const c = BY_ID.get(id)
  if (!c) throw new Error(`«@»: no command «${id}»`)
  return c
})
/** Commands registered but missing from the menu's order (a test keeps this empty). */
export const unorderedCommandIds = () => [...BY_ID.keys()].filter((id) => !(MENU_ORDER as readonly string[]).includes(id))

/** How well a query names a command: a whole word above a word's start, above a part of a word (0 — not at all). */
const MATCH_WEIGHT = { whole: 10000, start: 1000, wordStart: 500, part: 100 } as const
/** A part of a word counts from this many letters (one or two letters inside words match everything). */
const PART_MIN = 3

function matchWeight(c: NoteCommand, q: string): number {
  const title = c.title.toLowerCase()
  const words = [...c.keys, ...title.split(/[\s—-]+/)]
  if (c.keys.includes(q) || title === q) return MATCH_WEIGHT.whole
  if (c.keys.some((k) => k.startsWith(q)) || title.startsWith(q)) return MATCH_WEIGHT.start
  if (words.some((w) => w.startsWith(q))) return MATCH_WEIGHT.wordStart
  if (q.length >= PART_MIN && [...c.keys, title].some((w) => w.includes(q))) return MATCH_WEIGHT.part
  return 0
}
/** A command typed with its argument: its line says what will be inserted, it inserts it. */
const filledIn = (c: NoteCommand, m: RegExpExecArray): NoteCommand => ({ ...c, title: c.withArg!.title(m), run: (ctx) => c.withArg!.run(ctx, m) })

/**
 * The commands a query names (all of them for an empty one): the ones typed with their argument first, then by how
 * well the query names them (the menu's order between equals).
 */
export function matchCommands(query: string): readonly NoteCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return NOTE_COMMANDS
  const typed = NOTE_COMMANDS.flatMap((c) => {
    const m = c.withArg?.pattern.exec(query.trim())
    return m ? [filledIn(c, m)] : []
  })
  const named = NOTE_COMMANDS.map((c, i) => ({ c, w: matchWeight(c, q), i }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.c)
  return [...typed, ...named]
}

/** A sub-menu of «@»: emoji, a table's size, the notebook's boards, the chats of this device. */
export type PickerMode = { mode: 'emoji'; q: string } | { mode: 'table'; c?: number; r?: number } | { mode: 'board'; q: string } | { mode: 'chat'; q: string }
/**
 * The menu turned into a sub-menu by its keyword: «@эмодзи сердце» / «@emoji heart» — emoji (any one of the
 * words is enough), «@таблица» / «@table 3x4» / «@table3x4» — a table's size, «@доска …» — boards, «@чат …» — chats.
 */
export function pickerMode(query: string): PickerMode | undefined {
  const b = /^(доска|доски|board|boards)(?:\s+(.*))?$/i.exec(query)
  if (b) return { mode: 'board', q: (b[2] ?? '').trim() }
  const ch = /^(чат|чаты|chat|chats)(?:\s+(.*))?$/i.exec(query)
  if (ch) return { mode: 'chat', q: (ch[2] ?? '').trim() }
  const e = /^(эмодзи|эмоджи|emoji|смайлы|смайлики|smileys?)(?:\s+(.*))?$/i.exec(query)
  if (e) return { mode: 'emoji', q: (e[2] ?? '').trim() }
  const t = /^(таблица|table)(?:\s*(\d{1,2})\s*[x×х*]\s*(\d{1,3}))?\s*$/i.exec(query)
  if (t) return { mode: 'table', c: t[2] ? Number(t[2]) : undefined, r: t[3] ? Number(t[3]) : undefined }
  return undefined
}
