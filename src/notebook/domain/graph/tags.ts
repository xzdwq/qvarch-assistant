/**
 * A note's tags, as Obsidian writes them: `#тег` in the text (`#работа/релиз` — nested; found by `#работа` too) and
 * `tags:` in the front matter. Not a tag: a heading's `# `, a number (`#12`), a place in a link (`[[A#раздел]]`,
 * `https://x#a`), anything in `code`.
 */

export interface NoteTag {
  /** The key: lower case. */
  name: string
  label: string
  line: number
}

const TAG = /(?<![\p{L}\p{N}_/&#\\])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu
/** A tag being typed at a line's end: `#` (not after a word) and its first characters — [1]. */
export const TAG_TYPED = /(?<![\p{L}\p{N}_/&#\\])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)$/u
/** What a tag's name goes on with (the rest of it, as typed). */
export const TAG_REST = /^[\p{L}\p{N}_\-/]*$/u
/** A tag's name cleaned: no trailing `/` `-`; a number alone — none. */
function clean(raw: string): string | undefined {
  const t = raw.replace(/[/-]+$/, '').replace(/^#/, '').trim()
  return t && /[\p{L}_]/u.test(t) ? t : undefined
}
/** A text's links and code blanked (their `#` are not tags) — its lines kept. */
const blanked = (text: string) =>
  text.replace(/`[^`\n]*`|\[\[[^\]\n]*\]\]|\]\([^)\n]*\)|[a-z][\w+.-]*:\/\/[^\s)]+/gi, (m) => ' '.repeat(m.length))

/** The front matter's tags: `tags: [a, b]`, `tags: a, b`, or a list under `tags:`. */
function frontTags(lines: readonly string[]): Array<{ raw: string; line: number }> {
  if (lines[0]?.trim() !== '---') return []
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
  if (end < 0) return []
  const out: Array<{ raw: string; line: number }> = []
  for (let i = 1; i < end; i++) {
    const m = /^tags?\s*:\s*(.*)$/i.exec(lines[i])
    if (!m) continue
    const inline = m[1].replace(/^\[|\]$/g, '').trim()
    if (inline) for (const t of inline.split(/[,\s]+/)) out.push({ raw: t.replace(/^["']|["']$/g, ''), line: i })
    for (let j = i + 1; j < end && /^\s*-\s+/.test(lines[j]); j++) out.push({ raw: lines[j].replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, ''), line: j })
  }
  return out
}

/** The tags written on a note's first line (the tree shows them under its name). */
export const headTags = (text: string): string[] => tagsIn(text.slice(0, (text.indexOf('\n') + 1 || text.length + 1) - 1)).map((t) => t.label)

/** Where a line's tags are (the editor draws each as a chip): the `#`'s place, the tag's length with it, its name. */
export function tagSpans(line: string): Array<{ at: number; len: number; name: string }> {
  const out: Array<{ at: number; len: number; name: string }> = []
  for (const m of blanked(line).matchAll(TAG)) {
    const label = clean(m[1])
    if (label) out.push({ at: m.index ?? 0, len: label.length + 1, name: label.toLowerCase() })
  }
  return out
}

/** The note's tags, each once (its first place). */
export function tagsIn(text: string): NoteTag[] {
  const lines = text.split('\n')
  const found = frontTags(lines)
  blanked(text)
    .split('\n')
    .forEach((l, line) => {
      for (const m of l.matchAll(TAG)) found.push({ raw: m[1], line })
    })
  const out: NoteTag[] = []
  const seen = new Set<string>()
  for (const f of found) {
    const label = clean(f.raw)
    const name = label?.toLowerCase()
    if (!label || !name || seen.has(name)) continue
    seen.add(name)
    out.push({ name, label, line: f.line })
  }
  return out
}
