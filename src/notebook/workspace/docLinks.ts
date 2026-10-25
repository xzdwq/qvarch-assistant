import { docLink, parseDocLink } from '@shared/notebook/links'
import { ROLE_RIGHTS, sharedDocOf, sharedMark } from '@shared/transport/space'
import { openNoteAt } from './noteGoto'
import { serverCall } from '@renderer/lib/transport'
import { noteName } from '@nb/domain/notePaths'
import { doc } from './noteDocs'
import { docPaths, shareNote, sharedInfo } from './sharedDocs'
import { joinByCode } from './sharedFolders'

/**
 * Links to shared notes (`qvarch://doc/<id>?join=<code>`): one who has the note opens it; one who has not — joins it
 * by the link's code (a reader), then opens it. A note given to a chat gets such a link: shared first when it is not,
 * its code made by its owner.
 */

/** The note of a shared document here (none — not here). */
async function pathOfDoc(id: string): Promise<string | undefined> {
  return docPaths.get(id) ?? (await window.qa.vaultNotesWith(sharedMark(id)))[0]
}
/** The note a link points to: had here, else joined by its code (`join` — allowed to join). */
export async function docLinkPath(url: string, join: boolean): Promise<string> {
  const l = parseDocLink(url)
  if (!l) throw new Error('Это не ссылка на общую заметку')
  const had = await pathOfDoc(l.doc)
  if (had) return had
  if (!l.join || !join) throw new Error('Этой общей заметки здесь нет — нужно приглашение')
  return joinByCode(l.join)
}
async function textOf(path: string): Promise<string> {
  const d = doc(path)
  for (let i = 0; i < 200 && !d.loaded; i++) await new Promise((r) => setTimeout(r, 25))
  if (d.error) throw new Error(`Заметка «${path}»: ${d.error}`)
  return d.text
}
/**
 * A note's link for a chat: its shared document (a note not shared yet — shared now, its owner this person) with a
 * reader's code when this person may invite; one who may not — the link without a code (the space's members have it).
 */
export async function shareLinkOf(path: string): Promise<string> {
  const title = noteName(path)
  let id = sharedDocOf(await textOf(path))
  if (!id) {
    const space = await shareNote(path, title)
    id = sharedDocOf(await textOf(path))
    const { code } = await serverCall('space.invite', { space: space.id, role: 'reader' })
    return docLink(id, title, code)
  }
  const inf = sharedInfo.get(id)
  if (!inf?.space || !inf.role || !ROLE_RIGHTS[inf.role].manage) return docLink(id, title)
  const { code } = await serverCall('space.invite', { space: inf.space, role: 'reader' })
  return docLink(id, title, code)
}

/** A click on a shared note's link (a note, a chat): opened, joined first when needed. */
export const openDocLink = (url: string): void =>
  void docLinkPath(url, true)
    .then((path) => openNoteAt(path, parseDocLink(url)?.place))
    .catch((e: Error) => window.alert(e.message))
