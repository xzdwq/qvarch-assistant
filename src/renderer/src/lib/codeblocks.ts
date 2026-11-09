import { HighlightStyle, Language, LanguageDescription, LanguageSupport, StreamLanguage, defineLanguageFacet, foldService, languageDataProp, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import { GFM, parser as markdownParser } from '@lezer/markdown'

/**
 * Markdown inside a ```markdown fence — a language of its own (its own facet): a highlight style can be put on it
 * alone, never on the note's own Markdown around (which the live preview draws). Coloured as the editors around show
 * it (Markdown Preview Enhanced): headings, the marks (#, -, >, backticks), code, links, bold and italics.
 */
const fencedMarkdownData = defineLanguageFacet()
// (a bare Language does not tag its tree: the facet goes on the top node, or a scoped style never matches)
const FENCED_MARKDOWN = new Language(fencedMarkdownData, markdownParser.configure([GFM, { props: [languageDataProp.add({ Document: fencedMarkdownData })] }]), [], 'markdown')
export const fencedMarkdownHighlighting = syntaxHighlighting(
  HighlightStyle.define(
    [
      { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6, t.heading], color: 'var(--syntax-function)', fontWeight: '700' },
      { tag: t.processingInstruction, color: 'var(--syntax-special)' },
      { tag: t.monospace, color: 'var(--syntax-string)' },
      { tag: [t.link, t.url], color: 'var(--syntax-property)', textDecoration: 'underline' },
      { tag: t.strong, fontWeight: '700', color: 'var(--syntax-strong)' },
      { tag: t.emphasis, fontStyle: 'italic' },
      { tag: t.quote, color: 'var(--syntax-quote)' },
      { tag: t.labelName, color: 'var(--syntax-type)' },
      { tag: t.contentSeparator, color: 'var(--syntax-meta)' },
    ],
    { scope: FENCED_MARKDOWN },
  ),
)

/**
 * Code blocks of the notebook: the languages inside ``` fences (highlighting, folding) and formatting.
 * js · sql · json · bash · html (and ts / css as a bonus, they come with the same parsers).
 */
export const CODE_LANGUAGES: LanguageDescription[] = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'mjs', 'cjs'], load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'typescript', alias: ['ts', 'tsx'], load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }) }),
  LanguageDescription.of({ name: 'json', alias: ['json5', 'jsonc'], load: async () => (await import('@codemirror/lang-json')).json() }),
  LanguageDescription.of({ name: 'sql', alias: ['postgresql', 'postgres', 'pgsql', 'mysql', 'plsql'], load: async () => (await import('@codemirror/lang-sql')).sql({ dialect: (await import('@codemirror/lang-sql')).PostgreSQL, upperCaseKeywords: true }) }),
  LanguageDescription.of({ name: 'html', alias: ['htm', 'xml', 'vue', 'svg'], load: async () => (await import('@codemirror/lang-html')).html() }),
  LanguageDescription.of({ name: 'css', alias: ['scss', 'less'], load: async () => (await import('@codemirror/lang-css')).css() }),
  LanguageDescription.of({ name: 'markdown', alias: ['md', 'mdx'], load: async () => new LanguageSupport(FENCED_MARKDOWN) }),
  LanguageDescription.of({
    name: 'yaml',
    alias: ['yml'],
    load: async () => new (await import('@codemirror/language')).LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/yaml')).yaml)),
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py'],
    load: async () => new (await import('@codemirror/language')).LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/python')).python)),
  }),
  LanguageDescription.of({
    name: 'bash',
    alias: ['sh', 'shell', 'zsh', 'console', 'powershell', 'ps1', 'cmd'],
    load: async () => {
      const { shell } = await import('@codemirror/legacy-modes/mode/shell')
      return new (await import('@codemirror/language')).LanguageSupport(StreamLanguage.define(shell))
    },
  }),
]

/** The language a fence names: ```sql → "sql" (by name or alias), undefined when unknown. */
export function fenceLang(info: string): string | undefined {
  const name = info.trim().split(/\s+/)[0]?.toLowerCase()
  if (!name) return undefined
  return LanguageDescription.matchLanguageName(CODE_LANGUAGES, name, false)?.name
}
/** What the fence picker offers (the name goes after the fence). */
export const FENCE_PICK: Array<{ name: string; title: string }> = [
  { name: 'sql', title: 'SQL' },
  { name: 'js', title: 'JavaScript' },
  { name: 'ts', title: 'TypeScript' },
  { name: 'json', title: 'JSON' },
  { name: 'bash', title: 'Bash / shell' },
  { name: 'html', title: 'HTML' },
  { name: 'css', title: 'CSS' },
]
export const FORMATTABLE = new Set(['javascript', 'typescript', 'json', 'sql', 'html', 'css', 'bash'])

export { formatCode } from '@shared/codeformat'

/**
 * Folding by indentation for code whose parser gives no blocks (SQL, shell): a line folds the deeper-indented
 * lines right under it. Only inside a fenced block — the Markdown itself folds by its own rules.
 */
export const indentFold = foldService.of((state: EditorState, from: number) => {
  const tree = syntaxTree(state)
  let inCode = false
  tree.iterate({ from, to: from, enter: (n) => void (n.name === 'FencedCode' ? (inCode = true) : undefined) })
  if (!inCode) return null
  const line = state.doc.lineAt(from)
  if (!line.text.trim() || /^\s*(`{3,}|~{3,})/.test(line.text)) return null
  const ind = /^\s*/.exec(line.text)![0].length
  let end = line.number
  for (let no = line.number + 1; no <= state.doc.lines; no++) {
    const l = state.doc.line(no)
    if (/^\s*(`{3,}|~{3,})/.test(l.text)) break
    if (!l.text.trim()) continue
    if (/^\s*/.exec(l.text)![0].length <= ind) break
    end = no
  }
  if (end === line.number) return null
  return { from: line.to, to: state.doc.line(end).to }
})
