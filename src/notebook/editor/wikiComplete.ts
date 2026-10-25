import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { dirOf, noteName } from '@nb/domain/notePaths'
import { files } from '@nb/workspace/vaultTreeStore'
import { editorHost } from './editorHost'

/**
 * Typing `[[` offers the notebook's notes: picked — its name goes in (`[[Имя]]`; two notes of one name — by its path),
 * the link closed when it is not yet. `#` / `|` after the name (a section, a label) — typed as usual.
 */
export function wikiNotes(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  const m = /\[\[([^\][|#\n]*)$/.exec(line.text.slice(0, ctx.pos - line.from))
  if (!m) return null
  const self = ctx.state.facet(editorHost).notePath()
  const notes = files.value.filter((p) => p !== self && p.toLowerCase().endsWith('.md'))
  const count = new Map<string, number>()
  for (const p of notes) count.set(noteName(p).toLowerCase(), (count.get(noteName(p).toLowerCase()) ?? 0) + 1)
  const closed = line.text.slice(ctx.pos - line.from).startsWith(']]')
  return {
    from: ctx.pos - m[1].length,
    validFor: /^[^\][|#\n]*$/,
    options: notes.map((p) => {
      const name = noteName(p)
      // (a name two notes share: the path tells them apart)
      const target = (count.get(name.toLowerCase()) ?? 0) > 1 ? p.replace(/\.md$/i, '') : name
      return {
        label: name,
        detail: dirOf(p),
        apply: (v: EditorView, _c: unknown, from: number, to: number) => {
          const insert = closed ? target : `${target}]]`
          v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 2 : 0) } })
        },
      }
    }),
  }
}
