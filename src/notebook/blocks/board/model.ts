import { fenceBodyLines } from '../../domain/fence'

/** How a board stands in a note: only shown (always whole), or drawn on right there. */
export const BOARD_MODES = ['view', 'edit'] as const
export type BoardMode = (typeof BOARD_MODES)[number]

/**
 * A board in a note: ```board / path: <the board's vault path> / mode: edit / doc: <its shared document> ``` (no mode
 * — only shown, as before). A shared note's board is found by `doc` — never by its name (another participant may have
 * a board of the same name of their own); `path` is where it is in its author's notebook.
 */
export const boardMd = (path: string, mode: BoardMode = 'view', doc = '') => `\`\`\`board\npath: ${path}${mode === 'edit' ? '\nmode: edit' : ''}${doc ? `\ndoc: ${doc}` : ''}\n\`\`\``
/** A line `key: value` of the block ('' — none). */
function field(src: string, key: string): string {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'i')
  for (const l of fenceBodyLines(src)) {
    const m = re.exec(l)
    if (m) return m[1]
  }
  return ''
}
/** The board's vault path ('' — none). */
export const boardPathOf = (src: string) => field(src, 'path')
/** The board's shared document ('' — not a shared one). */
export const boardDocOf = (src: string) => (/^[0-9a-f-]{36}$/i.test(field(src, 'doc')) ? field(src, 'doc').toLowerCase() : '')
/** The board blocks of a note's text: each one's text (as it stands) and model. */
export function boardBlocksOf(text: string): Array<{ src: string; path: string; mode: BoardMode; doc: string }> {
  return [...text.matchAll(/^```board[ \t]*\n[\s\S]*?^```[ \t]*$/gm)].map((m) => ({ src: m[0], path: boardPathOf(m[0]), mode: boardModeOf(m[0]), doc: boardDocOf(m[0]) }))
}
/** How the board stands in the note. */
export const boardModeOf = (src: string): BoardMode => ((BOARD_MODES as readonly string[]).includes(field(src, 'mode')) ? (field(src, 'mode') as BoardMode) : 'view')
