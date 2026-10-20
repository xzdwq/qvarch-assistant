import type { BlockContext, Element, Line, MarkdownConfig } from '@lezer/markdown'

/**
 * A fenced code block whose closing fence is indented any amount (```` ``` ```` … `       ```` ` — as people write
 * them in lists and as other editors accept). CommonMark allows 3 spaces at most: a deeper closing fence would
 * leave the block open to the end of the note — no formatting below it, no «@» there. This parser runs before
 * the standard one and differs from it only in that.
 */
function fenceEnd(line: Line): number {
  if (line.next !== 96 && line.next !== 126) return -1
  let pos = line.pos + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) === line.next) pos++
  if (pos < line.pos + 3) return -1
  // a backtick fence's info has no backticks
  if (line.next === 96) for (let i = pos; i < line.text.length; i++) if (line.text.charCodeAt(i) === 96) return -1
  return pos
}
const spaceBack = (text: string, i: number, to: number) => {
  while (i > to && /\s/.test(text[i - 1])) i--
  return i
}

/** (the parser's own state — not in its typings, used by its own FencedCode the same way) */
const inner = <T>(x: T) => x as unknown as { depth: number; stack: unknown[] }

function parse(cx: BlockContext, line: Line): boolean {
  const end = fenceEnd(line)
  if (end < 0) return false
  const from = cx.lineStart + line.pos
  const ch = line.next
  const len = end - line.pos
  const infoFrom = line.skipSpace(end)
  const infoTo = spaceBack(line.text, line.text.length, infoFrom)
  const marks: Element[] = [cx.elt('CodeMark', from, from + len)]
  if (infoFrom < infoTo) marks.push(cx.elt('CodeInfo', cx.lineStart + infoFrom, cx.lineStart + infoTo))
  // the code's text: touching pieces joined into one (as the standard parser does)
  let text: [number, number] | undefined
  const addText = (a: number, b: number) => {
    if (text && text[1] === a) text[1] = b
    else {
      flush()
      text = [a, b]
    }
  }
  const flush = () => {
    if (text) marks.push(cx.elt('CodeText', text[0], text[1]))
    text = undefined
  }
  const add = (e: Element) => {
    flush()
    marks.push(e)
  }
  for (let first = true, empty = true, hasLine = false; cx.nextLine() && inner(line).depth >= inner(cx).stack.length; first = false) {
    let i = line.pos
    // the only difference: a closing fence at any indent
    while (i < line.text.length && line.text.charCodeAt(i) === ch) i++
    if (i - line.pos >= len && line.skipSpace(i) === line.text.length) {
      for (const m of line.markers) add(m)
      if (empty && hasLine) addText(cx.lineStart - 1, cx.lineStart)
      add(cx.elt('CodeMark', cx.lineStart + line.pos, cx.lineStart + i))
      cx.nextLine()
      break
    }
    hasLine = true
    if (!first) {
      addText(cx.lineStart - 1, cx.lineStart)
      empty = false
    }
    for (const m of line.markers) add(m)
    const a = cx.lineStart + line.basePos
    const b = cx.lineStart + line.text.length
    if (a < b) {
      addText(a, b)
      empty = false
    }
  }
  flush()
  cx.addElement(cx.elt('FencedCode', from, cx.prevLineEnd(), marks))
  return true
}

export const looseFence: MarkdownConfig = { parseBlock: [{ name: 'LooseFencedCode', before: 'FencedCode', parse }] }
