import { fenceBodyLines } from '../../domain/fence'

/** A board shown in a note: ```board / path: <the board's vault path> ```. */
export const boardMd = (path: string) => `\`\`\`board\npath: ${path}\n\`\`\``
/** The board's vault path ('' — none). */
export function boardPathOf(src: string): string {
  for (const l of fenceBodyLines(src)) {
    const m = /^\s*path\s*:\s*(.+?)\s*$/i.exec(l)
    if (m) return m[1]
  }
  return ''
}
