import type { DeviceInfo } from './protocol'

/**
 * A shared space: a document (later a folder) opened to other devices. Its members have roles; the owner invites by a
 * code and changes the roles. New members see the whole history.
 */
export const SPACE_ROLES = ['owner', 'editor', 'commenter', 'reader'] as const
export type SpaceRole = (typeof SPACE_ROLES)[number]
export const isSpaceRole = (x: unknown): x is SpaceRole => (SPACE_ROLES as readonly unknown[]).includes(x)

/** What each role may do. */
export const ROLE_RIGHTS: Record<SpaceRole, { edit: boolean; chat: boolean; manage: boolean }> = {
  owner: { edit: true, chat: true, manage: true },
  editor: { edit: true, chat: true, manage: false },
  commenter: { edit: false, chat: true, manage: false },
  reader: { edit: false, chat: false, manage: false },
}
export const ROLE_LABEL: Record<SpaceRole, string> = { owner: 'Владелец', editor: 'Редактор', commenter: 'Комментатор', reader: 'Читатель' }
/** The roles an invitation may give (the owner is one). */
export const INVITE_ROLES: readonly SpaceRole[] = ['editor', 'commenter', 'reader']

/** What is shared: one note, or a folder of them. */
export const SPACE_KINDS = ['doc', 'folder'] as const
export type SpaceKind = (typeof SPACE_KINDS)[number]

export interface SpaceMember extends DeviceInfo {
  role: SpaceRole
}
export interface SpaceDoc {
  id: string
  title: string
  /** Its place in the space: `Идеи/План.md` (a shared note alone — its file name). */
  path: string
  /** Deleted (kept a while: it may be brought back). */
  deleted?: boolean
}
export interface Space {
  id: string
  title: string
  kind: SpaceKind
  members: SpaceMember[]
  docs: SpaceDoc[]
  /** This device's role. */
  role: SpaceRole
}

const DOC_PATH_MAX = 400
/** The files a space holds: notes and boards. */
const DOC_EXT = /\.(md|qboard)$/i
/**
 * A document's path in a space as kept: `/` between parts, no empty, `.` or `..` part, no leading slash, a note's or
 * a board's name. Not one — null.
 */
export function cleanDocPath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const parts = path.replace(/\\/g, '/').split('/').map((p) => p.trim())
  if (parts.some((p) => !p || p === '.' || p === '..' || /[<>:"|?*\u0000-\u001f]/.test(p))) return null
  const out = parts.join('/')
  const m = DOC_EXT.exec(out)
  return out.length <= DOC_PATH_MAX && m && out.length > m[0].length ? out : null
}
/** A document's name: its file's, without the extension. */
export const docTitleOf = (path: string): string => path.split('/').pop()!.replace(DOC_EXT, '')
/** A path not taken: the same, or with « (2)», « (3)»… before the extension. */
export function freeDocPath(path: string, taken: (p: string) => boolean): string {
  if (!taken(path)) return path
  const ext = DOC_EXT.exec(path)?.[0] ?? ''
  const base = path.slice(0, path.length - ext.length)
  for (let n = 2; ; n++) if (!taken(`${base} (${n})${ext}`)) return `${base} (${n})${ext}`
}

/** The file of a shared folder that holds its space's id (a dot file: the notebook's tree does not list it). */
export const SPACE_LINK_FILE = '.qa-space'

/** A note's or a recording's media file as notes embed it (`.images/…`, `.audio/…`). */
export const MEDIA_REL = /^\.(images\/[\w.-]+\.(?:png|jpe?g|gif|webp|bmp)|audio\/[\w.-]+\.webm)$/i
/**
 * What a sync of a space's files did: the files fetched to this computer; the ones the server has not yet (the one
 * who added them has not sent them — they come when the server is told: an event); the ones that failed (why — tried
 * again later).
 */
export interface MediaReport {
  fetched: string[]
  absent: string[]
  failed: Record<string, string>
}
export const NO_MEDIA: MediaReport = { fetched: [], absent: [], failed: {} }

/**
 * Where a shared note's file stands while it is not on this computer: on its way (asked from the server), waiting
 * for the connection, waiting for the one who added it (the server has it not yet), failed (tried again later).
 */
export const MEDIA_WAITS = ['loading', 'offline', 'absent', 'failed'] as const
export type MediaWait = { state: Exclude<(typeof MEDIA_WAITS)[number], 'failed'> } | { state: 'failed'; why: string }
/** Each file asked by a sync: where it stands after it (here — null). */
export function mediaWaitsOf(r: MediaReport, asked: readonly string[]): Record<string, MediaWait | null> {
  const out: Record<string, MediaWait | null> = {}
  for (const rel of asked) out[rel] = r.failed[rel] ? { state: 'failed', why: r.failed[rel] } : r.absent.includes(rel) ? { state: 'absent' } : null
  return out
}
/** Each wait in words, for the person. */
const WAIT_TEXT: { [K in MediaWait['state']]: (w: Extract<MediaWait, { state: K }>) => string } = {
  loading: () => 'загружается…',
  offline: () => 'загрузится, когда будет связь с сервером',
  absent: () => 'ждёт отправки — появится, когда добавивший будет в сети',
  failed: (w) => `не загрузилось: ${w.why} — попробуем ещё раз`,
}
export const mediaWaitText = (w: MediaWait): string => (WAIT_TEXT[w.state] as (w: MediaWait) => string)(w)
/** Why a file of a sync is not here, for the person (none — it is). */
export function mediaWhy(r: MediaReport, rel: string): string | undefined {
  const w = mediaWaitsOf(r, [rel])[rel]
  return w ? mediaWaitText(w) : undefined
}
/** A test file of a set (`.files/<набор>/<файл>`): no part starts with a dot (no `..`, no hidden files). */
export const TEST_FILE_REL = /^\.files\/[^/\\.][^/\\]{0,119}\/[^/\\.][^/\\]{0,199}$/
/** A file a space keeps for its notes: a picture, a recording, a test file. */
export const isSpaceFile = (rel: string): boolean => MEDIA_REL.test(rel) || TEST_FILE_REL.test(rel)
/** The media files a text embeds (`![[.images/…]]`, `![[.audio/…]]`), each once. */
export function mediaRefs(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/!\[\[([^\]\n]+)\]\]/g)) if (MEDIA_REL.test(m[1])) out.add(m[1])
  return [...out]
}

/** An invitation's code: 8 letters and digits people can read out (no 0/O, 1/I/L). */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_LENGTH = 8
/** A code as typed: spaces, dashes and case do not matter. */
export const normalizeInvite = (code: string): string => code.toUpperCase().replace(/[\s-]/g, '')
/** A code as shown: two groups of four. */
export const showInvite = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`

/**
 * A shared note carries its document's id on its first line — the same text for everyone, so the link survives a
 * rename or a move: `<!-- qa:shared doc=<id> -->`.
 */
export const sharedMark = (doc: string) => `<!-- qa:shared doc=${doc} -->`
export function sharedDocOf(text: string): string {
  const m = /^<!-- qa:shared doc=([0-9a-f-]{36}) -->/i.exec(text)
  return m ? m[1].toLowerCase() : ''
}
/** The text with the mark on its first line (a text marked already — as is). */
export const withSharedMark = (text: string, doc: string): string => (sharedDocOf(text) ? text : `${sharedMark(doc)}\n${text}`)
