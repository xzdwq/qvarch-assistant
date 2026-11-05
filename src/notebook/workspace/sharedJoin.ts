import { formatOf, type SharedFormat } from '@shared/transport/sharedFormats'
import { fromB64, toB64 } from '@shared/transport/sharedText'
import { sharedMark, type Space } from '@shared/transport/space'
import { serverCall } from '@renderer/lib/transport'
import { docs } from './noteDocs'
import { adopt, isHeld, SHARED_FOLDER, spaces } from './sharedDocs'

/** A note shared and a shared note joined or read: the ways a file and a server's document meet. */

/** A note shared: a space of its own, its text the document's first state. */
export async function shareNote(path: string, title: string): Promise<Space> {
  const d = docs.get(path)
  const fmt = formatOf(path)
  if (!d?.loaded || !fmt) throw new Error('Заметка ещё не открыта')
  const st = fmt.model()
  st.setLocal(d.text)
  const r = await serverCall('space.share', { title, update: toB64(st.state()) })
  if (!r.doc) throw new Error('Сервер не создал документ')
  spaces.set(r.space.id, r.space)
  await adopt(r.doc, r.space.id, st, path)
  return r.space
}

/** A document's text fetched from the server as a new file of this kind: its text, and its state kept here. */
export async function fetchText(doc: string, fmt: SharedFormat): Promise<string> {
  const st = fmt.model()
  const r = await serverCall('doc.open', { doc, sv: toB64(st.stateVector()) })
  // only read: not held open (no presence shown, no edits sent here) unless it is open in an editor
  if (!isHeld(doc)) void serverCall('doc.close', { doc }).catch(() => undefined)
  st.apply(fromB64(r.update), 'remote')
  await window.qa.sharedSave(doc, { state: toB64(st.state()), text: st.value })
  return st.value
}

/** A shared note joined: its note made in «Общие» (or the one already here). Its path. */
export async function joinDoc(sp: Space): Promise<string> {
  const doc = sp.docs.find((d) => !d.deleted)
  if (!doc) throw new Error('В пространстве нет документов')
  const hits = await window.qa.vaultSearch(sharedMark(doc.id))
  const had = hits.find((h) => h.path.endsWith('.md'))?.path
  if (had) return had
  const fmt = formatOf(doc.path) ?? formatOf('.md')!
  return window.qa.vaultCreate(SHARED_FOLDER, fmt.kind, doc.title, await fetchText(doc.id, fmt))
}
