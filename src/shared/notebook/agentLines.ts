/**
 * The lines an AI agent wrote in a personal note (a shared one keeps it in its edits' marks): each by its text — a
 * line changed since is no longer the agent's. A line of nothing but signs (a fence, a rule, a bracket) is nobody's:
 * the same one written by a person elsewhere would be taken for the agent's.
 */

/** A line's text → the agent that wrote it (by the line's hash). */
export type AgentLines = Record<string, string>

/** A line that can be someone's: it holds a letter or a digit. */
export const markable = (line: string): boolean => /[\p{L}\p{N}]/u.test(line)

/** A line's hash (its text trimmed; FNV-1a). */
export function lineHash(line: string): string {
  let h = 0x811c9dc5
  for (const ch of line.trim()) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0
  return h.toString(36)
}

/**
 * The agent's lines after it wrote a note: the lines it put in (not there before) — its; the ones kept from before —
 * while the text still has them (the rest dropped: the record stays the note's size).
 */
export function agentLinesAfter(kept: AgentLines, before: string, after: string, agent: string): AgentLines {
  const had = new Set(before.split('\n').map((l) => l.trim()))
  const lines = after.split('\n').filter(markable)
  const now = new Set(lines.map(lineHash))
  const out: AgentLines = {}
  for (const [h, name] of Object.entries(kept)) if (now.has(h)) out[h] = name
  for (const l of lines) if (!had.has(l.trim())) out[lineHash(l)] = agent
  return out
}

/** The first line a change put in (a link to the note points there); none — nothing new but signs. */
export function firstWrittenLine(before: string, after: string): string | undefined {
  const had = new Set(before.split('\n').map((l) => l.trim()))
  return after.split('\n').find((l) => markable(l) && !had.has(l.trim()))
}

/** Which lines of a text the agents wrote (0-based line → the agent's name). */
export function agentLineMarks(text: string, kept: AgentLines): Map<number, string> {
  const out = new Map<number, string>()
  if (!Object.keys(kept).length) return out
  const lines = text.split('\n')
  lines.forEach((l, i) => {
    const name = markable(l) ? kept[lineHash(l)] : undefined
    if (name) out.set(i, name)
  })
  // the lines of nothing but signs (blank, a fence's end) between two of one agent's — its too: one run, no gaps
  let prev: { at: number; name: string } | undefined
  lines.forEach((l, i) => {
    if (!markable(l)) return
    const name = out.get(i)
    if (name && prev?.name === name) for (let j = prev.at + 1; j < i; j++) out.set(j, name)
    prev = name ? { at: i, name } : undefined
  })
  return out
}
