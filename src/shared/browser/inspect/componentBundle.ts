/**
 * A component copied as one Markdown text (for a person or an AI): what it is (the framework's component, its file,
 * its props), its HTML, its CSS, the JavaScript bound to it — each event handler with its code, from the source
 * when the site's source maps show it.
 */

/** What a framework says of the element's component (the page's probe — frameworkProbe.ts). */
export interface ComponentInfo {
  framework: string
  name?: string
  file?: string
  line?: number
  /** Its props, shallow (values as text). */
  props?: Record<string, string>
  /** The components it is inside, the nearest first. */
  owners?: string[]
}
/** An event handler on the element or inside it. */
export interface HandlerInfo {
  type: string
  /** The element it is on, in words (the component's root — «сам элемент»). */
  on: string
  capture?: boolean
  once?: boolean
  passive?: boolean
  /** The built script's place. */
  script?: string
  line?: number
  /** The handler's code as built. */
  code?: string
  /** Its place and code in the source (by the site's source map). */
  source?: { file: string; line: number; code?: string }
}
export interface ComponentBundle {
  page: string
  selector: string
  html: string
  css: string
  info: ComponentInfo[]
  handlers: HandlerInfo[]
  /** What could not be read and why. */
  notes: string[]
}

/** The longest a handler's built code is copied (a bundle's whole function can be huge). */
const MAX_CODE = 4000
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n/* … ещё ${s.length - n} символов */` : s)
/** A fence that the text inside cannot close. */
const fence = (lang: string, body: string) => {
  const ticks = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)))
  return `${ticks}${lang}\n${body}\n${ticks}`
}

/** The component as Markdown. */
export function componentMarkdown(b: ComponentBundle): string {
  const out: string[] = [`# Компонент \`${b.selector}\``, `Страница: ${b.page}`]
  for (const i of b.info) {
    const where = i.file ? ` — \`${i.file}${i.line ? `:${i.line}` : ''}\`` : ''
    out.push(`**${i.framework}:** ${i.name ?? 'без имени'}${where}${i.owners?.length ? `  \nвнутри: ${i.owners.join(' ← ')}` : ''}`)
    if (i.props && Object.keys(i.props).length) out.push(fence('json', JSON.stringify(i.props, null, 2)))
  }
  out.push('## HTML', fence('html', b.html))
  out.push('## CSS', fence('css', b.css || '/* своих правил нет */'))
  out.push('## JavaScript')
  if (!b.handlers.length) out.push('Обработчиков событий на элементе и внутри нет (или их вешает фреймворк на корень приложения — см. компонент выше).')
  // (one handler code once: frameworks hang the same function on many elements)
  const seen = new Set<string>()
  for (const h of b.handlers) {
    const flags = [h.capture ? 'capture' : '', h.once ? 'once' : '', h.passive ? 'passive' : ''].filter(Boolean).join(', ')
    const at = h.source ? `${h.source.file}:${h.source.line}` : h.script ? `${h.script}:${(h.line ?? 0) + 1}` : ''
    out.push(`### \`${h.type}\` — ${h.on}${flags ? ` (${flags})` : ''}${at ? `  \n\`${at}\`` : ''}`)
    const key = at || h.code || ''
    if (seen.has(key)) {
      out.push('_тот же обработчик, что выше_')
      continue
    }
    seen.add(key)
    if (h.source?.code) out.push('Исходник (по source map):', fence('js', h.source.code))
    else if (h.code) out.push(fence('js', cut(h.code, MAX_CODE)))
  }
  if (b.notes.length) out.push('## Примечания', ...b.notes.map((n) => `- ${n}`))
  return out.join('\n\n')
}
