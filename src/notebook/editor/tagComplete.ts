import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { TAG_REST, TAG_TYPED } from '@nb/domain/graph/tags'
import { codeFencesField } from './codeBlocks'

/**
 * Typing `#` and a letter offers the notebook's tags (the most used first; nested ones by their whole name). Not in
 * code (a block, `inline`), not after a word (`C#`) — the same rule the tags are read by. A bare `#` is a heading
 * being started — nothing offered.
 */

/** The notebook's tags, asked again at most this often (not on every key). */
const FRESH_MS = 5000
let cache: { at: number; list: Promise<Array<{ label: string; count: number }>> } | undefined
const tagList = () => {
  if (!cache || Date.now() - cache.at > FRESH_MS) cache = { at: Date.now(), list: window.qa.vaultTags().catch(() => []) }
  return cache.list
}

export async function noteTags(ctx: CompletionContext): Promise<CompletionResult | null> {
  const line = ctx.state.doc.lineAt(ctx.pos)
  const before = line.text.slice(0, ctx.pos - line.from)
  const m = TAG_TYPED.exec(before)
  if (!m) return null
  // in code: a fenced block, or an `inline` one still open on the line
  if (ctx.state.field(codeFencesField, false)?.some((f) => ctx.pos > f.from && ctx.pos <= f.to)) return null
  if ((before.match(/`/g) ?? []).length % 2) return null
  const typed = m[1].toLowerCase()
  const tags = (await tagList()).filter((t) => t.label.toLowerCase() !== typed)
  if (!tags.length) return null
  return {
    from: ctx.pos - m[1].length,
    validFor: TAG_REST,
    options: tags.map((t, i) => ({ label: t.label, detail: String(t.count), boost: -i / tags.length })),
  }
}
