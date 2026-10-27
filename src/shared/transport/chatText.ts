import { linkParts, type NoteLinkRef } from '../notebook/links'
import { mentionParts } from './chat'
import type { DeviceInfo } from './protocol'

/**
 * A message's text as Markdown to draw (agents answer in Markdown: lists, bold, code, tables): its mentions and its
 * links made marks of their own — a mention lit (one's own strongly), a link followed by the app on a click (its index
 * in `links`) — never inside code, which stays as written. The HTML made of it is cleaned before it is shown.
 */
export interface ChatMarkdown {
  md: string
  links: NoteLinkRef[]
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`)
/** Code (a fenced block, an inline span) apart from the rest. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g

export function chatMarkdown(text: string, members: readonly DeviceInfo[], me: string): ChatMarkdown {
  const links: NoteLinkRef[] = []
  const marked = (plain: string) =>
    mentionParts(plain, members)
      .map((p) =>
        p.who
          ? `<span class="mention${p.who.id === me ? ' me' : ''}">${esc(p.text)}</span>`
          : linkParts(p.text)
              .map((q) => (q.link ? `<a data-chat-link="${links.push(q.link) - 1}">${esc(q.text)}</a>` : q.text))
              .join(''),
      )
      .join('')
  const md = text
    .split(CODE)
    .map((part, i) => (i % 2 ? part : marked(part)))
    .join('')
  return { md, links }
}
