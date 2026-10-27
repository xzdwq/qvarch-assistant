import { linksIn, type LinkKind, type NoteLinkRef } from '../notebook/links'

/**
 * What an agent's turn touched, call by call: the document and its sections, its memory, other notes, tasks, events,
 * pages, searches, components run, the work tracked — read, written, run, searched. Each tool says what its call
 * touches (a registry: one line per tool); a tool not in it — the tool itself. The journal keeps them; the graph of
 * «ИИ в документе» is drawn from them.
 */
export const TOUCH_KINDS = ['doc', 'section', 'memory', 'note', 'folder', 'component', 'jira', 'event', 'web', 'file', 'search', 'chat', 'work', 'guide', 'tool'] as const
export type TouchKind = (typeof TOUCH_KINDS)[number]
export const TOUCH_OPS = ['read', 'write', 'run', 'search'] as const
export type TouchOp = (typeof TOUCH_OPS)[number]

export interface Touch {
  kind: TouchKind
  op: TouchOp
  /** What it is, to go to: a note's path (`path#Раздел` — a part of it), a link's address, a search's words. */
  ref: string
  label: string
  ok: boolean
  /** The call's number in the turn (from 0). */
  step: number
  tool: string
}
/** The calls kept per turn at most. */
export const TOUCHES_MAX = 60

type Args = Record<string, unknown>
type Seen = Omit<Touch, 'ok' | 'step' | 'tool'>
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
/** A note's path as the tools take it (a name alone — a note in the top). */
const notePath = (p: string) => (/\.(md|qboard)$/i.test(p) ? p : `${p}.md`).replace(/^\/+/, '')
const noteName = (p: string) => (p.split('/').pop() ?? p).replace(/\.(md|qboard)$/i, '')
const note = (op: TouchOp, path: string): Seen[] => (path ? [{ kind: 'note', op, ref: notePath(path), label: noteName(path) }] : [])
const cut = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n)}…` : t)

/** Each kind of link — what reading it touches. */
const LINKED: Record<LinkKind, (l: NoteLinkRef) => Seen> = {
  note: (l) => ({ kind: l.kind === 'note' && l.section ? 'section' : 'note', op: 'read', ref: `${notePath(l.target)}${l.kind === 'note' && l.section ? `#${l.section}` : ''}`, label: l.kind === 'note' && l.section ? `${noteName(l.target)} · ${l.section}` : noteName(l.target) }),
  file: (l) => ({ kind: 'file', op: 'read', ref: l.target, label: noteName(l.target) }),
  jira: (l) => ({ kind: 'jira', op: 'read', ref: l.target, label: ('label' in l && l.label) || l.target.split('/').pop() || l.target }),
  event: (l) => ({ kind: 'event', op: 'read', ref: l.target, label: ('label' in l && l.label) || 'событие' }),
  doc: (l) => ({ kind: 'note', op: 'read', ref: l.target, label: ('label' in l && l.label) || 'общая заметка' }),
  web: (l) => ({ kind: 'web', op: 'read', ref: l.target, label: cut(l.target.replace(/^https?:\/\//, ''), 40) }),
}
const jiraKey = (k: string): Seen[] => (k ? [{ kind: 'jira', op: 'read', ref: `qvarch://jira/${k}`, label: k }] : [])

/** Each tool — what a call of it touches (`doc` — the document the turn is in). */
const TOOL_TOUCHES: Record<string, (a: Args, doc: string) => Seen[]> = {
  doc_read: (_a, doc) => [{ kind: 'doc', op: 'read', ref: doc, label: noteName(doc) }],
  doc_edit: (_a, doc) => [{ kind: 'doc', op: 'write', ref: doc, label: noteName(doc) }],
  doc_section: (a, doc) => [{ kind: 'section', op: 'write', ref: `${doc}#${s(a.heading).replace(/^#+\s*/, '')}`, label: s(a.heading).replace(/^#+\s*/, '') }],
  doc_memory: () => [{ kind: 'memory', op: 'write', ref: '', label: 'память документа' }],
  link_read: (a) => {
    const raw = s(a.link)
    const l = linksIn(raw)[0] ?? { kind: 'note' as const, raw, target: raw.replace(/^\[\[|\]\]$/g, '') }
    return raw ? [LINKED[l.kind](l)] : []
  },
  notes_search: (a) => [{ kind: 'search', op: 'search', ref: s(a.query), label: `«${cut(s(a.query), 40)}»` }],
  notes_list: (a) => [{ kind: 'folder', op: 'read', ref: s(a.folder), label: s(a.folder) || 'все заметки' }],
  note_backlinks: (a, doc) => note('read', s(a.path) || doc),
  chat_history: () => [{ kind: 'chat', op: 'read', ref: '', label: 'история чата' }],
  share_to_chat: (a) => note('write', s(a.path)),
  folder_create: (a) => [{ kind: 'folder', op: 'write', ref: [s(a.folder), s(a.name)].filter(Boolean).join('/'), label: s(a.name) }],
  note_read: (a) => note('read', s(a.path)),
  note_results: (a) => note('read', s(a.path)),
  note_create: (a) => note('write', [s(a.folder), s(a.name)].filter(Boolean).join('/')),
  note_write: (a) => note('write', s(a.path)),
  note_edit: (a) => note('write', s(a.path)),
  data_set: (a) => note('write', s(a.path)),
  note_run: (a) => [{ kind: 'component', op: 'run', ref: s(a.block) ? `${notePath(s(a.path))}#${s(a.block)}` : notePath(s(a.path)), label: s(a.block) || `${noteName(s(a.path))}: всё` }],
  pw_check: (a) => [{ kind: 'component', op: 'write', ref: `${notePath(s(a.path))}#${s(a.block)}`, label: `${s(a.block)} · ${s(a.kind)}` }],
  jira_issue: (a) => (s(a.key) ? jiraKey(s(a.key)) : [{ kind: 'search', op: 'search', ref: s(a.query), label: `Jira «${cut(s(a.query), 30)}»` }]),
  task_folder: (a) => [...jiraKey(s(a.key)), { kind: 'folder', op: 'write', ref: s(a.key) || s(a.title), label: s(a.title) || s(a.key) }],
  work_track: (a) => [{ kind: 'work', op: 'write', ref: s(a.key), label: s(a.label) || s(a.key) || 'работа' }],
  work_today: (a) => [{ kind: 'work', op: 'read', ref: s(a.day), label: s(a.day) ? `работа ${s(a.day)}` : 'работа сегодня' }],
  work_period: (a) => [{ kind: 'work', op: 'read', ref: s(a.period), label: `работа: ${s(a.period) || [s(a.from), s(a.to)].join('–')}` }],
  page_look: (a) => [{ kind: 'web', op: 'read', ref: s(a.url), label: cut(s(a.url).replace(/^https?:\/\//, ''), 40) || 'страница' }],
  browser_open: (a) => [{ kind: 'web', op: 'read', ref: s(a.url), label: cut(s(a.url).replace(/^https?:\/\//, ''), 40) }],
  note_components: () => [{ kind: 'guide', op: 'read', ref: '', label: 'компоненты' }],
  qvarch_guide: () => [{ kind: 'guide', op: 'read', ref: '', label: 'справка Qvarch' }],
}

/** What one call touched (a tool not in the registry — the tool itself). */
export function touchesOf(tool: string, args: Args, doc: string, ok: boolean, step: number): Touch[] {
  const seen = Object.hasOwn(TOOL_TOUCHES, tool) ? TOOL_TOUCHES[tool](args, doc) : [{ kind: 'tool' as const, op: 'run' as const, ref: tool, label: tool }]
  return seen.map((t) => ({ ...t, label: t.label || t.ref || tool, ok, step, tool }))
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
export const isTouch = (x: unknown): x is Touch =>
  isObj(x) && (TOUCH_KINDS as readonly unknown[]).includes(x.kind) && (TOUCH_OPS as readonly unknown[]).includes(x.op) && typeof x.ref === 'string' && typeof x.label === 'string' && typeof x.step === 'number'
