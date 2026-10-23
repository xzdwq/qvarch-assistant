import { parseTable, type TableModel } from '../blocks/table/model'
import { splitFence } from './fence'
import { findBlocks } from './findBlocks'
import { findLoops } from './loop'

/**
 * Every table of a note is a variable: its own name (`name=` in its settings comment), or — a table not named yet —
 * one given here, the same each time the text is read (`table`, `table2`… by the order, past the names taken). A
 * name another block holds (or a table above) is the other's: the table is not published, it says so.
 */

/** The word a table's variable is named from. */
export const TABLE_VAR_BASE = 'table'

export interface TableVar {
  /** The table's first line in the note (its settings comment when it has one). */
  line0: number
  table: TableModel
  name: string
  /** The name given here — not in the file yet (written with the table's next save). */
  given: boolean
  /** Who holds the name already (the table is not published): another block, a table above. */
  clash?: 'block' | 'table'
}

/** `base`, `base2`, `base3`… — the first one not taken. */
export function freeVarName(base: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}${n}`
    if (!taken.has(name)) return name
  }
}

/** The names the note's other blocks publish under: fenced blocks' `name=`, loops'. */
function blockNames(lines: readonly string[], blocks: ReturnType<typeof findBlocks>): Set<string> {
  const fenced = blocks.filter((b) => /^(`{3,}|~{3,})/.test(b.src)).map((b) => splitFence(b.src).info.name)
  const loops = findLoops(lines).map((l) => l.info.name)
  return new Set([...fenced, ...loops].filter((n): n is string => !!n))
}

/** The note's tables with their variables, in order. */
export function tableVars(text: string): TableVar[] {
  const lines = text.split('\n')
  const blocks = findBlocks(lines)
  const others = blockNames(lines, blocks)
  const used = new Set(others)
  const out: TableVar[] = blocks.filter((b) => b.kind === 'table').map((b) => ({ line0: b.line0, table: parseTable(b.src), name: '', given: false }))
  // the named ones first: a name in the file is never moved by a table given one above it
  for (const v of out) {
    const name = v.table.name
    if (!name) continue
    v.name = name
    if (used.has(name)) v.clash = others.has(name) ? 'block' : 'table'
    else used.add(name)
  }
  for (const v of out) {
    if (v.name) continue
    v.name = freeVarName(TABLE_VAR_BASE, used)
    v.given = true
    used.add(v.name)
  }
  return out
}
/** Every name the note's blocks and tables hold (a new block's name is picked past them). */
export function noteVarNames(text: string): Set<string> {
  const lines = text.split('\n')
  return new Set([...blockNames(lines, findBlocks(lines)), ...tableVars(text).map((v) => v.name)])
}
