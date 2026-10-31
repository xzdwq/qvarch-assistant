/**
 * A scenario's code read for the checks that wrap it: where a statement stands at the top level (not inside a
 * step's callback, a loop's body…), what a locator held in a variable is.
 */

/** Each line's nesting at its start (brackets of every kind; strings, template text and comments skipped). */
export function depthsOf(lines: readonly string[]): number[] {
  const out: number[] = []
  let depth = 0
  let quote = ''
  for (const line of lines) {
    out.push(depth)
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quote) {
        if (ch === '\\') i++
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === '/' && line[i + 1] === '/') break
      if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if ('({['.includes(ch)) depth++
      else if (')}]'.includes(ch)) depth = Math.max(0, depth - 1)
    }
    // (a quote left open at the line's end: only a template goes on)
    if (quote && quote !== '`') quote = ''
  }
  return out
}

/** The top-level statement a line belongs to: the nearest line at or before it standing at nesting 0. */
export function topLevelLine(lines: readonly string[], at: number): number {
  const d = depthsOf(lines)
  for (let i = at; i >= 0; i--) if (d[i] === 0 && lines[i].trim()) return i
  return 0
}

/**
 * A locator as it may stand anywhere: one held in a variable (`box` of `const box = page.getByPlaceholder(…)`) — its
 * expression; else as it is.
 */
export function locatorExpr(lines: readonly string[], locator: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(locator)) return locator
  const decl = new RegExp(`^\\s*(?:const|let|var)\\s+${locator.replace(/\$/g, '\\$')}\\s*=\\s*(.+?);?\\s*$`)
  for (const l of lines) {
    const m = decl.exec(l)
    // (a locator: from the page — an arrow returning one stands for it too)
    if (m && /\bpage\./.test(m[1])) return m[1].replace(/^\(\)\s*=>\s*/, '')
  }
  return locator
}
