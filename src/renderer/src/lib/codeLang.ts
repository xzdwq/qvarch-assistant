import type { Extension } from '@codemirror/state'
import { formatCode } from './codeblocks'

/**
 * The code kinds the tools know (the notebook's code blocks + XML and YAML): their highlighting, a guess of
 * the kind by the text, and formatting.
 */
export type CodeKind = 'json' | 'yaml' | 'xml' | 'html' | 'sql' | 'css' | 'javascript' | 'typescript' | 'bash'
export const CODE_KINDS: Array<{ id: CodeKind; title: string }> = [
  { id: 'json', title: 'JSON' },
  { id: 'yaml', title: 'YAML' },
  { id: 'xml', title: 'XML' },
  { id: 'html', title: 'HTML' },
  { id: 'sql', title: 'SQL' },
  { id: 'css', title: 'CSS' },
  { id: 'javascript', title: 'JavaScript' },
  { id: 'typescript', title: 'TypeScript' },
  { id: 'bash', title: 'Shell' },
]
export const kindTitle = (k?: string) => CODE_KINDS.find((x) => x.id === k)?.title ?? 'Текст'

/** CodeMirror's highlighting of a kind (loaded when first needed). */
export async function languageOf(kind: string): Promise<Extension> {
  switch (kind) {
    case 'js':
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript()
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true })
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'sql': {
      const m = await import('@codemirror/lang-sql')
      return m.sql({ dialect: m.PostgreSQL, upperCaseKeywords: true })
    }
    case 'html':
      return (await import('@codemirror/lang-html')).html()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    case 'md':
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'http':
    case 'xml':
    case 'yaml':
    case 'bash': {
      const { StreamLanguage, LanguageSupport } = await import('@codemirror/language')
      const mode =
        kind === 'http' ? (await import('@codemirror/legacy-modes/mode/http')).http : kind === 'xml' ? (await import('@codemirror/legacy-modes/mode/xml')).xml : kind === 'yaml' ? (await import('@codemirror/legacy-modes/mode/yaml')).yaml : (await import('@codemirror/legacy-modes/mode/shell')).shell
      return new LanguageSupport(StreamLanguage.define(mode))
    }
    default:
      return []
  }
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
export async function formatKind(kind: CodeKind, text: string, opts: { indent?: number; sortKeys?: boolean } = {}): Promise<string> {
  const indent = opts.indent ?? 2
  if (kind === 'json') {
    const v = JSON.parse(text) as unknown
    return JSON.stringify(opts.sortKeys ? sortDeep(v) : v, null, indent)
  }
  if (kind === 'yaml') {
    const y = await import('js-yaml')
    return y.dump(y.load(text), { indent, lineWidth: -1, noRefs: true, sortKeys: !!opts.sortKeys }).replace(/\s+$/, '')
  }
  if (kind === 'xml') return formatXml(text, indent)
  return formatCode(kind, text)
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
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element
      const attrs = [...el.attributes].map((a) => ` ${a.name}="${attr(a.value)}"`).join('')
      const kids = [...el.childNodes].filter((c) => !(c.nodeType === Node.TEXT_NODE && !c.textContent?.trim()))
      if (!kids.length) return void out.push(`${pad(d)}<${el.tagName}${attrs}/>`)
      if (kids.length === 1 && kids[0].nodeType === Node.TEXT_NODE) return void out.push(`${pad(d)}<${el.tagName}${attrs}>${esc(kids[0].textContent!.trim())}</${el.tagName}>`)
      out.push(`${pad(d)}<${el.tagName}${attrs}>`)
      for (const c of kids) walk(c, d + 1)
      out.push(`${pad(d)}</${el.tagName}>`)
    } else if (n.nodeType === Node.TEXT_NODE) out.push(pad(d) + esc(n.textContent!.trim()))
    else if (n.nodeType === Node.CDATA_SECTION_NODE) out.push(`${pad(d)}<![CDATA[${n.textContent}]]>`)
    else if (n.nodeType === Node.COMMENT_NODE) out.push(`${pad(d)}<!--${n.textContent}-->`)
    else if (n.nodeType === Node.PROCESSING_INSTRUCTION_NODE) out.push(`${pad(d)}<?${(n as ProcessingInstruction).target} ${(n as ProcessingInstruction).data}?>`)
  }
  for (const c of doc.childNodes) walk(c, 0)
  return out.join('\n')
}
