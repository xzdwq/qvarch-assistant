/**
 * Jira's rich text (Atlassian Document Format) → Markdown, to show a task's description with the app's own
 * Markdown view. Unknown nodes give their text; media and other embeds give nothing. The result is cut at `max`.
 */
interface Node {
  type: string
  text?: string
  content?: Node[]
  attrs?: Record<string, any>
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
}

function inline(n: Node): string {
  switch (n.type) {
    case 'text': {
      let t = n.text ?? ''
      for (const m of n.marks ?? []) {
        if (m.type === 'strong') t = `**${t}**`
        else if (m.type === 'em') t = `*${t}*`
        else if (m.type === 'code') t = `\`${t}\``
        else if (m.type === 'strike') t = `~~${t}~~`
        else if (m.type === 'link' && m.attrs?.href) t = `[${t}](${m.attrs.href})`
      }
      return t
    }
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

function block(n: Node, indent = ''): string {
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
      return kids.map((k) => block(k)).join('\n\n').split('\n').map((l) => `> ${l}`).join('\n')
    case 'panel':
      return kids.map((k) => block(k)).join('\n\n').split('\n').map((l) => `> ${l}`).join('\n')
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
    const md = block(doc as Node).replace(/\n{3,}/g, '\n\n').trim()
    return md.length > max ? `${md.slice(0, max).trimEnd()}…` : md
  } catch {
    return ''
  }
}
