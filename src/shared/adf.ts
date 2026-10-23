/**
 * Jira's rich text (Atlassian Document Format) → Markdown, to show a task's description with the app's own
 * Markdown view. Unknown nodes give their text; media and other embeds give nothing. The result is cut at `max`.
 */
type Attrs = Record<string, unknown>
/** A mark on a text node (bold, link…); its type is any string Jira sends, known ones are rendered. */
interface AdfMark {
  type: string
  attrs?: Attrs
}
/** A node of the document tree, inline or block. */
interface AdfNode {
  type: string
  text?: string
  content?: AdfNode[]
  attrs?: Attrs
  marks?: AdfMark[]
}

/** Wraps a text into a mark's Markdown; a mark it can't render leaves the text as it is. */
type MarkHandler = (text: string, attrs: Attrs | undefined) => string
const markHandlers = {
  strong: (t) => `**${t}**`,
  em: (t) => `*${t}*`,
  code: (t) => `\`${t}\``,
  strike: (t) => `~~${t}~~`,
  link: (t, attrs) => (attrs?.href ? `[${t}](${String(attrs.href)})` : t),
} satisfies Record<string, MarkHandler>
type MarkType = keyof typeof markHandlers
const isMarkType = (type: string): type is MarkType => Object.hasOwn(markHandlers, type)

/** A text node with its marks applied, innermost first. */
const markedText = (n: AdfNode): string =>
  (n.marks ?? []).reduce((t, m) => (isMarkType(m.type) ? markHandlers[m.type](t, m.attrs) : t), n.text ?? '')

function inline(n: AdfNode): string {
  switch (n.type) {
    case 'text':
      return markedText(n)
    case 'hardBreak':
      return '  \n'
    case 'mention':
      return String(n.attrs?.text ?? '@')
    case 'emoji':
      return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
    case 'inlineCard':
      return n.attrs?.url ? `<${n.attrs.url}>` : ''
    case 'date':
      return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toLocaleDateString('ru-RU') : ''
    case 'status':
      return n.attrs?.text ? `\`${n.attrs.text}\`` : ''
    default:
      return (n.content ?? []).map(inline).join('')
  }
}

/** A quote-like block (quote, panel): its children with «> » before every line. */
const quoted = (kids: AdfNode[]): string =>
  kids
    .map((k) => block(k))
    .join('\n\n')
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')

function block(n: AdfNode, indent = ''): string {
  const kids = n.content ?? []
  switch (n.type) {
    case 'doc':
      return kids.map((k) => block(k, indent)).filter(Boolean).join('\n\n')
    case 'paragraph':
      return indent + kids.map(inline).join('')
    case 'heading':
      return `${'#'.repeat(Math.min(6, Number(n.attrs?.level) || 2))} ${kids.map(inline).join('')}`
    case 'bulletList':
    case 'orderedList':
      return kids
        .map((li, i) => {
          const mark = n.type === 'bulletList' ? '- ' : `${i + 1}. `
          const parts = (li.content ?? []).map((c) => (c.type === 'paragraph' ? (c.content ?? []).map(inline).join('') :`\n${block(c, indent + '   ')}`))
          return `${indent}${mark}${parts.join('')}`
        })
        .join('\n')
    case 'taskList':
      return kids.map((t) => `${indent}- [${t.attrs?.state === 'DONE' ? 'x' : ' '}] ${(t.content ?? []).map(inline).join('')}`).join('\n')
    case 'codeBlock':
      return `\`\`\`${n.attrs?.language ?? ''}\n${kids.map((k) => k.text ?? '').join('')}\n\`\`\``
    case 'blockquote':
    case 'panel':
      return quoted(kids)
    case 'rule':
      return '---'
    case 'table': {
      const rows = kids.map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => p.content?.map(inline).join('') ?? '').join(' ').replace(/\|/g, '\\|')))
      if (!rows.length) return ''
      const w = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`
      return [line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].join('\n')
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return ''
    default:
      return kids.length ? kids.map((k) => block(k, indent)).join('\n') : inline(n)
  }
}

export function adfToMarkdown(doc: unknown, max = 4000): string {
  if (!doc) return ''
  if (typeof doc === 'string') return doc.slice(0, max)
  try {
    const md = block(doc as AdfNode).replace(/\n{3,}/g, '\n\n').trim()
    return md.length > max ? `${md.slice(0, max).trimEnd()}…` : md
  } catch {
    return ''
  }
}
