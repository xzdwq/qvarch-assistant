import DOMPurify from 'dompurify'
import { Marked, type TokenizerAndRendererExtension } from 'marked'

/**
 * Markdown as the app's components draw it (a callout's text, a toggle's, a table's cell, a contents' line) — the
 * way the note itself and the editors around (Obsidian, Markdown Preview Enhanced) read it: GitHub's flavour (tables,
 * lists, code, links) and the notes' own wiki links `[[note]]`, `[[folder/note|text]]`, `[[note#part]]` — a link the
 * app opens (data-wiki: its target). The text comes from anywhere: the HTML is sanitised.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `[[target]]` / `[[target|text]]` (an embed `![[…]]` is the editor's — a picture, a recording — not a link here). */
const wikiLink: TokenizerAndRendererExtension = {
  name: 'wiki',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(src)
    if (m) return { type: 'wiki', raw: m[0], target: m[1].trim(), text: (m[2] ?? m[1]).trim() }
    return undefined
  },
  renderer: (t) => `<a class="wiki" href="#" data-wiki="${escapeHtml(String(t.target))}">${escapeHtml(String(t.text))}</a>`,
}

const md = new Marked({ gfm: true, breaks: true, async: false })
md.use({ extensions: [wikiLink] })

/** The text as HTML, sanitised: whole blocks (paragraphs, lists, code), or `inline` — one line's (a cell, a heading). */
export function markdownHtml(text: string, inline = false): string {
  const html = (inline ? md.parseInline(text) : md.parse(text)) as string
  return DOMPurify.sanitize(html)
}
