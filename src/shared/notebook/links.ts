import { noteLinkUrl, parseNoteLink } from '../noteEvents'

/**
 * The links of a note, of every kind, found one way: a registry — each kind how it is written and what it points to.
 * The agent's context lists them, its `link_read` opens them; the editor and the chat read them the same way.
 */

/** A link found in a text. */
export type NoteLinkRef =
  /** `[[Name]]`, `[[folder/Name#Раздел|подпись]]` — a note (a part of it). */
  | { kind: 'note'; raw: string; target: string; section?: string; label?: string }
  /** `![[.images/x.png]]` — a file the note shows. */
  | { kind: 'file'; raw: string; target: string }
  /** `[…](qvarch://jira/KEY)` */
  | { kind: 'jira'; raw: string; target: string; label?: string }
  /** `[…](qvarch://event/day/id)` */
  | { kind: 'event'; raw: string; target: string; label?: string }
  /** `[…](qvarch://doc/<id>)` — a shared note (anyone of its space has it). */
  | { kind: 'doc'; raw: string; target: string; label?: string }
  /** `[…](https://…)` and bare addresses. */
  | { kind: 'web'; raw: string; target: string; label?: string }
export type LinkKind = NoteLinkRef['kind']

/** A shared note's link: its document, a code to join it by (one who has no access yet — gets it by a click), a place in it. */
export const docLink = (doc: string, title: string, join?: string, place?: string) =>
  `[${title.replace(/[[\]\n]/g, ' ').trim() || 'заметка'}](qvarch://doc/${doc}${join ? `?join=${join}` : ''}${place && placeKey(place) ? `#${encodeURIComponent(placeKey(place))}` : ''})`
const DOC_URL = /^qvarch:\/\/doc\/([0-9a-f-]{36})(?:\?join=([\w-]{4,32}))?(?:#([^\s)]+))?$/i
/** A shared note's link read: its document, its code, its place (none — not such a link). */
export function parseDocLink(url: string): { doc: string; join?: string; place?: string } | undefined {
  const m = DOC_URL.exec(url)
  if (!m) return undefined
  let place: string | undefined
  try {
    place = m[3] ? decodeURIComponent(m[3]) : undefined
  } catch {
    place = undefined
  }
  return { doc: m[1].toLowerCase(), ...(m[2] ? { join: m[2] } : {}), ...(place ? { place } : {}) }
}

/**
 * A place of a note as a link names it (`[[Заметка#место]]`, `qvarch://doc/<id>#место`): a heading's title or a
 * line's start, as one plain line — no list or heading marks, nothing a link's syntax would break on.
 */
export const placeKey = (line: string): string =>
  line
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '')
    .replace(/[[\]|#()\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
/** The line a place names (0-based): a heading of that title first, then a line that starts so; none — not found. */
export function placeLine(text: string, place: string): number | undefined {
  const want = placeKey(place).toLowerCase()
  if (!want) return undefined
  const keys = text.split('\n').map((l) => ({ heading: /^#{1,6}\s/.test(l), key: placeKey(l).toLowerCase() }))
  const at = [keys.findIndex((k) => k.heading && k.key === want), keys.findIndex((k) => k.key === want), keys.findIndex((k) => k.key.startsWith(want))].find((i) => i >= 0)
  return at
}

/** How each kind of link is written (an AI agent is told so: a link written so opens as the app opens it). */
export const LINK_GUIDE: Record<LinkKind, string> = {
  note: '[[Имя заметки]] или [[папка/Имя]]; на место в ней — [[Имя#Раздел]]',
  file: '![[.images/картинка.png]] — показать файл в заметке',
  jira: `[KEY-1 Название задачи](${noteLinkUrl({ kind: 'jira', key: 'KEY-1' })}) — задача Jira: у всех читателей раскрывается карточкой с описанием`,
  event: `[Название](${noteLinkUrl({ kind: 'event', day: 'YYYY-MM-DD', id: 'id' })}) — событие «Моей работы» (ссылку дают work_today / work_period)`,
  doc: '[Название](qvarch://doc/<id>) — общая заметка (ссылку даёт share_to_chat)',
  web: '[текст](https://…)',
}

/** A Markdown link `[label](url)` by what its address is. */
function markdownLink(raw: string, label: string, url: string): NoteLinkRef | undefined {
  const ev = parseNoteLink(url)
  if (ev?.kind === 'jira') return { kind: 'jira', raw, target: url, label }
  if (ev?.kind === 'event') return { kind: 'event', raw, target: url, label }
  if (DOC_URL.test(url)) return { kind: 'doc', raw, target: url, label }
  if (/^https?:\/\//i.test(url)) return { kind: 'web', raw, target: url, label }
  return undefined
}

/** Each way a link is written: its pattern (global) and what a match points to (none — not a link after all). */
const LINK_FORMS: ReadonlyArray<{ re: RegExp; read: (m: RegExpMatchArray) => NoteLinkRef | undefined }> = [
  { re: /!\[\[([^\]\n]+)\]\]/g, read: (m) => ({ kind: 'file', raw: m[0], target: m[1].trim() }) },
  {
    re: /(?<!!)\[\[([^\]\n]+)\]\]/g,
    read: (m) => {
      const [ref, label] = m[1].split('|')
      const [target, section] = ref.split('#')
      return target.trim() ? { kind: 'note', raw: m[0], target: target.trim(), ...(section?.trim() ? { section: section.trim() } : {}), ...(label?.trim() ? { label: label.trim() } : {}) } : undefined
    },
  },
  { re: /(?<!!)\[([^\]\n]*)\]\(([^)\s]+)\)/g, read: (m) => markdownLink(m[0], m[1], m[2]) },
]

/** The links of a text in their order, each once (the same link twice — once). Code blocks are not text: skipped. */
export function linksIn(text: string): NoteLinkRef[] {
  const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, (b) => b.replace(/[^\n]/g, ' '))
  const found: Array<{ at: number; link: NoteLinkRef }> = []
  for (const f of LINK_FORMS)
    for (const m of prose.matchAll(f.re)) {
      const link = f.read(m)
      if (link) found.push({ at: m.index ?? 0, link })
    }
  const key = (l: NoteLinkRef) => `${l.kind}:${l.target}:${l.kind === 'note' ? (l.section ?? '') : ''}`
  const seen = new Set<string>()
  const out: NoteLinkRef[] = []
  for (const { link } of found.sort((a, b) => a.at - b.at)) {
    if (seen.has(key(link))) continue
    seen.add(key(link))
    out.push(link)
  }
  return out
}

/** The links of a text to click (files are shown, not followed), in order, none inside another. */
function clickable(text: string): Array<{ at: number; link: NoteLinkRef }> {
  const found: Array<{ at: number; link: NoteLinkRef }> = []
  for (const f of LINK_FORMS)
    for (const m of text.matchAll(f.re)) {
      const link = f.read(m)
      if (link && link.kind !== 'file') found.push({ at: m.index ?? 0, link })
    }
  let end = 0
  return found
    .sort((a, b) => a.at - b.at)
    .filter((x) => {
      if (x.at < end) return false
      end = x.at + x.link.raw.length
      return true
    })
}
/** A text in parts: plain ones and links (a chat's message shows its links to click). */
export function linkParts(text: string): Array<{ text: string; link?: NoteLinkRef }> {
  const out: Array<{ text: string; link?: NoteLinkRef }> = []
  let at = 0
  for (const { at: start, link } of clickable(text)) {
    if (start > at) out.push({ text: text.slice(at, start) })
    out.push({ text: (link.kind !== 'file' && link.label) || link.target, link })
    at = start + link.raw.length
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}
/**
 * A text's links to notes given places where they name none (an agent's answer pointed at what it wrote):
 * `placeOf` — the place for a link (none — the link stays as it is).
 */
export function withPlaces(text: string, placeOf: (l: NoteLinkRef) => string | undefined): string {
  let out = ''
  let at = 0
  for (const { at: start, link } of clickable(text)) {
    out += text.slice(at, start)
    at = start + link.raw.length
    const place = link.kind === 'note' ? (link.section ? undefined : placeOf(link)) : link.kind === 'doc' && !parseDocLink(link.target)?.place ? placeOf(link) : undefined
    const key = place && placeKey(place)
    if (key && link.kind === 'note') out += `[[${link.target}#${key}${link.label ? `|${link.label}` : ''}]]`
    else if (key && link.kind === 'doc') out += `[${link.label ?? ''}](${link.target}#${encodeURIComponent(key)})`
    else out += link.raw
  }
  return out + text.slice(at)
}
/**
 * A text's `[[links]]` to notes moved, pointed at their new places (a link by name — the new name; by path — the new
 * path; its section and label kept). Code blocks are not touched. None changed — undefined.
 * `moved` — old path → new path; `before` — the notebook's notes before the move (how the links resolved then).
 */
export function relinked(text: string, moved: ReadonlyMap<string, string>, before: string[], resolve: (target: string, files: string[]) => string | undefined): string | undefined {
  let changed = false
  const parts = text.split(/^((?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)\s*$)/m)
  const out = parts.map((part, i) => {
    // (the odd parts are the code blocks the split kept)
    if (i % 2) return part
    return part.replace(/(?<!!)\[\[([^\]\n]+)\]\]/g, (raw, inner: string) => {
      const [ref, label] = inner.split('|')
      const [target, section] = ref.split('#')
      const to = moved.get(resolve(target.trim(), before) ?? '')
      if (!to) return raw
      changed = true
      const name = target.includes('/') ? to.replace(/\.md$/i, '') : (to.split('/').pop() ?? to).replace(/\.md$/i, '')
      return `[[${name}${section !== undefined ? `#${section}` : ''}${label !== undefined ? `|${label}` : ''}]]`
    })
  })
  return changed ? out.join('') : undefined
}
/** A part of a note: its heading's lines (to the next heading of the same level or higher); none — no such heading. */
export function sectionOf(text: string, heading: string): string | undefined {
  const lines = text.split('\n')
  const want = heading.trim().toLowerCase()
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === want)
  if (at < 0) return undefined
  const level = /^#+/.exec(lines[at])![0].length
  const end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= level)
  return lines.slice(at, end < 0 ? undefined : end).join('\n')
}
