import type { Extension } from '@codemirror/state'
import type { StreamParser } from '@codemirror/language'
import { formatCode } from './codeblocks'

/**
 * The code kinds the tools know (the notebook's code blocks + XML and YAML): their highlighting, a guess of
 * the kind by the text, and formatting.
 */
export const CODE_KINDS = [
  { id: 'json', title: 'JSON' },
  { id: 'yaml', title: 'YAML' },
  { id: 'xml', title: 'XML' },
  { id: 'html', title: 'HTML' },
  { id: 'sql', title: 'SQL' },
  { id: 'css', title: 'CSS' },
  { id: 'javascript', title: 'JavaScript' },
  { id: 'typescript', title: 'TypeScript' },
  { id: 'bash', title: 'Shell' },
] as const satisfies ReadonlyArray<{ id: string; title: string }>
export type CodeKind = (typeof CODE_KINDS)[number]['id']
export const kindTitle = (k?: string) => CODE_KINDS.find((x) => x.id === k)?.title ?? 'Текст'

type LanguageLoader = () => Promise<Extension>
/** A highlighting by a CodeMirror 5 mode (the kinds with no own package). */
const legacyMode =
  (load: () => Promise<StreamParser<unknown>>): LanguageLoader =>
  async () => {
    const { StreamLanguage, LanguageSupport } = await import('@codemirror/language')
    return new LanguageSupport(StreamLanguage.define(await load()))
  }
const javascript: LanguageLoader = async () => (await import('@codemirror/lang-javascript')).javascript()
const markdown: LanguageLoader = async () => (await import('@codemirror/lang-markdown')).markdown()
/** The highlightings by a kind's name (its aliases too), each loaded when first needed. */
const LANGUAGES: Record<string, LanguageLoader> = {
  js: javascript,
  javascript,
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  json: async () => (await import('@codemirror/lang-json')).json(),
  sql: async () => {
    const m = await import('@codemirror/lang-sql')
    return m.sql({ dialect: m.PostgreSQL, upperCaseKeywords: true })
  },
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  md: markdown,
  markdown,
  http: legacyMode(async () => (await import('@codemirror/legacy-modes/mode/http')).http),
  xml: legacyMode(async () => (await import('@codemirror/legacy-modes/mode/xml')).xml),
  yaml: legacyMode(async () => (await import('@codemirror/legacy-modes/mode/yaml')).yaml),
  bash: legacyMode(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
}

/** CodeMirror's highlighting of a kind (loaded when first needed); none for an unknown one. */
export async function languageOf(kind: string): Promise<Extension> {
  return Object.hasOwn(LANGUAGES, kind) ? LANGUAGES[kind]() : []
}

const HTML_TAG = /<(!doctype\s+html|html|head|body|div|span|p|a|ul|ol|li|table|tr|td|th|img|br|script|style|meta|link|h[1-6]|form|input|button|section|header|footer|nav|main)\b/i
/** The kind a text looks like (undefined — plain text). Cheap: the first bytes and a few rules. */
export function detectKind(text: string): CodeKind | undefined {
  const t = text.trim()
  if (!t) return undefined
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      // a broken JSON is still JSON when it looks like one through and through
      if (/^\{\s*"/.test(t) || /^\[\s*[{["\d]/.test(t)) return 'json'
    }
  }
  if (t.startsWith('<')) {
    if (/^<\?xml\b/i.test(t)) return 'xml'
    if (HTML_TAG.test(t.slice(0, 2000))) return 'html'
    if (/^<[\w:-]+[\s>/]/.test(t)) return 'xml'
  }
  const head = t.slice(0, 4000)
  if (/^\s*(select|insert\s+into|update\s+\w|delete\s+from|with\s+\w+\s+as\s*\(|create\s+(table|view|index|or\s+replace|function|unique)|alter\s+table|drop\s+(table|view|index)|merge\s+into|truncate)\b/i.test(head)) return 'sql'
  if (/^#!\/|^\s*(\$ |sudo |npm |npx |pnpm |yarn |git |cd |ls |echo |export |docker |kubectl )/m.test(head) && !/[{};]\s*$/m.test(head)) return 'bash'
  if (looksYaml(head)) return 'yaml'
  if (/^\s*[.#@:\w-][^{}\n]*\{[^}]*:[^}]*;?\s*\}/m.test(head) && !/\b(function|const|let|var|=>|return)\b/.test(head)) return 'css'
  if (/\b(interface|type)\s+\w+\s*[={<]|:\s*(string|number|boolean)\b|\bimport\s+type\b/.test(head)) return 'typescript'
  if (/\b(function|const|let|var|return|import|export|class)\b|=>|console\./.test(head)) return 'javascript'
  return undefined
}
/** Most lines are `key: value`, `- item`, comments or `---` — and there are a few of them. */
function looksYaml(head: string): boolean {
  const lines = head.split('\n').filter((l) => l.trim())
  if (lines.length < 2 || /[{};]\s*$/m.test(head)) return false
  const keys = lines.filter((l) => /^\s*[\w"'.-]+\s*:(\s|$)/.test(l)).length
  const ok = lines.filter((l) => /^\s*(- |-$|#|---|\.\.\.)/.test(l) || /^\s*[\w"'.-]+\s*:(\s|$)/.test(l) || /^\s{2,}\S/.test(l)).length
  return keys >= 1 && ok / lines.length >= 0.8
}
export const canFormat = (k?: string): k is CodeKind => !!k && CODE_KINDS.some((x) => x.id === k)

/** Formats a text of a kind; throws with a short message when it does not parse. */
interface FormatOptions {
  indent: number
  sortKeys: boolean
}
/** The kinds formatted here; the others — by the shared code formatter. */
const OWN_FORMATTERS: Partial<Record<CodeKind, (text: string, o: FormatOptions) => string | Promise<string>>> = {
  json: (text, o) => {
    const v = JSON.parse(text) as unknown
    return JSON.stringify(o.sortKeys ? sortDeep(v) : v, null, o.indent)
  },
  yaml: async (text, o) => {
    const y = await import('js-yaml')
    return y.dump(y.load(text), { indent: o.indent, lineWidth: -1, noRefs: true, sortKeys: o.sortKeys }).replace(/\s+$/, '')
  },
  xml: (text, o) => formatXml(text, o.indent),
}
export async function formatKind(kind: CodeKind, text: string, opts: { indent?: number; sortKeys?: boolean } = {}): Promise<string> {
  const own = OWN_FORMATTERS[kind]
  return own ? own(text, { indent: opts.indent ?? 2, sortKeys: !!opts.sortKeys }) : formatCode(kind, text)
}
export function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]))
  return v
}

/** XML laid out one element per line (text-only elements stay on their line); comments / CDATA kept. */
export function formatXml(xml: string, indent = 2): string {
  const doc = new DOMParser().parseFromString(xml.trim(), 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error((err.textContent ?? 'не XML').split('\n')[0].trim().slice(0, 160))
  const pad = (n: number) => ' '.repeat(n * indent)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const attr = (s: string) => esc(s).replace(/"/g, '&quot;')
  const out: string[] = []
  const decl = /^<\?xml[^?]*\?>/.exec(xml.trim())
  if (decl) out.push(decl[0])
  const walk = (n: Node, d: number) => {
    switch (n.nodeType) {
      case Node.ELEMENT_NODE: {
        const el = n as Element
        const attrs = [...el.attributes].map((a) => ` ${a.name}="${attr(a.value)}"`).join('')
        const kids = [...el.childNodes].filter((c) => !(c.nodeType === Node.TEXT_NODE && !c.textContent?.trim()))
        if (!kids.length) return void out.push(`${pad(d)}<${el.tagName}${attrs}/>`)
        if (kids.length === 1 && kids[0].nodeType === Node.TEXT_NODE) return void out.push(`${pad(d)}<${el.tagName}${attrs}>${esc(kids[0].textContent!.trim())}</${el.tagName}>`)
        out.push(`${pad(d)}<${el.tagName}${attrs}>`)
        for (const c of kids) walk(c, d + 1)
        out.push(`${pad(d)}</${el.tagName}>`)
        return
      }
      case Node.TEXT_NODE:
        return void out.push(pad(d) + esc(n.textContent!.trim()))
      case Node.CDATA_SECTION_NODE:
        return void out.push(`${pad(d)}<![CDATA[${n.textContent}]]>`)
      case Node.COMMENT_NODE:
        return void out.push(`${pad(d)}<!--${n.textContent}-->`)
      case Node.PROCESSING_INSTRUCTION_NODE: {
        const pi = n as ProcessingInstruction
        return void out.push(`${pad(d)}<?${pi.target} ${pi.data}?>`)
      }
    }
  }
  for (const c of doc.childNodes) walk(c, 0)
  return out.join('\n')
}
