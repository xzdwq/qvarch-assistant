/** A note's browser renamed: the name its Playwright blocks pick it by (`in=…`) follows it. */

const FENCE_HEAD = /^\s*(`{3,}|~{3,})/
const BROWSER_HEAD = /^\s*(`{3,}|~{3,})\s*browser\b/
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The note's text with the browser block at `line` (its fence's first line, from 1) renamed `from` → `to`: its own
 * `name=` (none — one added), and every other fence line's `in=<from>` (a Playwright block that runs in it). None —
 * that line is not a browser block's.
 */
export function renameBrowserIn(text: string, line: number, from: string | undefined, to: string): string | undefined {
  const lines = text.split('\n')
  const i = line - 1
  const head = lines[i]
  if (head === undefined || !BROWSER_HEAD.test(head)) return undefined
  const own = from ? new RegExp(`(\\s)name=${escape(from)}(?=\\s|$)`) : undefined
  lines[i] = own?.test(head) ? head.replace(own, `$1name=${to}`) : `${head.trimEnd()} name=${to}`
  if (from) {
    const uses = new RegExp(`(\\s)in=${escape(from)}(?=\\s|$)`)
    for (let k = 0; k < lines.length; k++) if (k !== i && FENCE_HEAD.test(lines[k])) lines[k] = lines[k].replace(uses, `$1in=${to}`)
  }
  return lines.join('\n')
}

/** Another block of the note holds the name already (`name=<it>` on any line but the browser's own). */
export function nameTakenIn(text: string, name: string, ownLine: number): boolean {
  const re = new RegExp(`\\sname=${escape(name)}(?=\\s|$)`)
  return text.split('\n').some((l, k) => k !== ownLine - 1 && FENCE_HEAD.test(l) && re.test(l))
}
