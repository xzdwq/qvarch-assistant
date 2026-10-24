import { reactive } from 'vue'
import { isComment, type ChatRoom } from '@shared/transport/chat'
import { ROLE_RIGHTS } from '@shared/transport/space'
import { chatRooms } from '@renderer/lib/chat'
import { serverCall } from '@renderer/lib/transport'
import { anchorFor, rangeFor, sharedDocOfPath, sharedInfo, sharedTick } from './sharedDocs'

/**
 * The comments of a shared note: each a discussion of the space's members about a place of the note (it goes with the
 * text — by anyone's edits; its text deleted — «текст удалён», kept in the list), solved or open. What the screen
 * shows of them: the open list, a discussion, a new comment being written.
 */
export interface NoteComment {
  room: ChatRoom
  /** Its place in the note now (none — not known yet here). */
  at?: { from: number; to: number; gone: boolean }
}

/** The comments of a note, by their place (the gone ones and the not-placed — last). */
export function commentsOf(path: string): NoteComment[] {
  void sharedTick.n
  const doc = sharedDocOfPath(path)
  if (!doc) return []
  return chatRooms.value
    .filter((r) => isComment(r) && r.doc === doc)
    .map((room) => ({ room, at: rangeFor(path, room.anchor!) }))
    .sort((a, b) => (a.at && !a.at.gone ? a.at.from : Infinity) - (b.at && !b.at.gone ? b.at.from : Infinity))
}
/** One may comment in this note (a shared one, a role that may write in its discussions). */
export function canComment(path: string): boolean {
  const role = sharedInfo.get(sharedDocOfPath(path))?.role
  return !!role && ROLE_RIGHTS[role].chat
}

/** What the comments' panel shows, and for which note. */
export const commentUi = reactive<{ path: string; mode: 'list' | 'thread' | 'new'; room?: string; draft?: { from: number; to: number; quote: string } }>({ path: '', mode: 'list' })
/** A comment's discussion opened (from its mark in the text, the list, a notification). */
export function openComment(path: string, room: string): void {
  Object.assign(commentUi, { path, mode: 'thread', room, draft: undefined })
}
/** A new comment on a place of the note, being written. */
export function newComment(path: string, from: number, to: number): void {
  const a = anchorFor(path, from, to)
  if (!a) return
  Object.assign(commentUi, { path, mode: 'new', room: undefined, draft: { from, to, quote: a.quote } })
}
export function closeComments(): void {
  Object.assign(commentUi, { path: '', mode: 'list', room: undefined, draft: undefined })
}

/** The comment written: sent with its place (taken anew — the text may have moved meanwhile). */
export async function addComment(path: string, from: number, to: number, text: string): Promise<ChatRoom> {
  const anchor = anchorFor(path, from, to)
  const doc = sharedDocOfPath(path)
  if (!anchor || !doc) throw new Error('Заметка не общая — комментарии только в общих заметках')
  return serverCall('space.comment', { doc, anchor, text, clientId: crypto.randomUUID() })
}
export const resolveComment = (room: string, resolved: boolean) => serverCall('space.resolve', { room, resolved })

/** The note's editor shows a place (the text selected, scrolled to it). */
export function gotoComment(path: string, c: NoteComment): void {
  if (c.at && !c.at.gone) window.dispatchEvent(new CustomEvent('qa:note-goto', { detail: { path, from: c.at.from, to: c.at.to } }))
}
