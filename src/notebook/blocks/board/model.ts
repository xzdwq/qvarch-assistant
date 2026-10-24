import { fenceBodyLines } from '../../domain/fence'

/** How a board stands in a note: only shown (always whole), or drawn on right there. */
export const BOARD_MODES = ['view', 'edit'] as const
export type BoardMode = (typeof BOARD_MODES)[number]

/** A board in a note: ```board / path: <the board's vault path> / mode: edit ``` (no mode — only shown, as before). */
export const boardMd = (path: string, mode: BoardMode = 'view') => `\`\`\`board\npath: ${path}${mode === 'edit' ? '\nmode: edit' : ''}\n\`\`\``
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
/** How the board stands in the note. */
export const boardModeOf = (src: string): BoardMode => ((BOARD_MODES as readonly string[]).includes(field(src, 'mode')) ? (field(src, 'mode') as BoardMode) : 'view')
