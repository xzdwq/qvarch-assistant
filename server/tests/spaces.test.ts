import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { TransportClient } from '../../src/main/transport/client'
import { makeKeys, signerOf } from '../../src/main/transport/keys'
import { TRANSPORT_PATH, type TransportEvent } from '../../src/shared/transport/protocol'
import { Db } from '../src/db'
import { startTransport, type Transport } from '../src/hub'
import { MODULES } from '../src/modules'
import { DocStore, docText } from '../src/modules/doc/docStore'
import { startPg } from './pg'
import { SharedMedia } from '../../src/main/transport/sharedMedia'
import { SpacePasses } from '../../src/main/transport/spacePasses'
import { ChatFiles } from '../../src/main/transport/chatFiles'
import { SharedText } from '../../src/shared/transport/sharedText'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Shared documents between two devices on a real PostgreSQL: a note shared, an invitation by code with a role, edits
 * of both merged and sent live, presence, the space's chat and its members, a reader's edit refused, a member removed.
 */
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('не дождались')
    await new Promise((r) => setTimeout(r, 30))
  }
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const bytes = (s: string) => Buffer.from(s, 'base64')

let pg: Awaited<ReturnType<typeof startPg>>
let db: Db
let server: Transport
beforeAll(async () => {
  pg = await startPg()
  const url = pg.url
  db = new Db(url)
  server = await startTransport({ port: 0, databaseUrl: url, accessCode: '', version: 'test' }, db, MODULES)
  // (a database started while the whole run loads the machine may take a while)
}, 120_000)
afterAll(async () => {
  await server?.close()
  await db?.close()
  await pg?.stop()
})

/** An app with a document of its own (Yjs, as the app keeps it). */
async function app(name: string) {
  const events: TransportEvent[] = []
  const client = new TransportClient({ url: `ws://127.0.0.1:${server.port}${TRANSPORT_PATH}`, name: () => name, signer: signerOf(makeKeys(), () => ''), onState: () => undefined, onEvent: (e) => events.push(e) })
  client.start()
  await until(() => client.state.status === 'online')
  const y = new Y.Doc()
  const text = y.getText('text')
  /** The document opened on the server: what it lacks sent, what it has taken; its edits applied from then on. */
  async function open(doc: string) {
    const r = await client.request('doc.open', { doc, sv: b64(Y.encodeStateVector(y)) })
    Y.applyUpdate(y, bytes(r.update), 'remote')
    return r
  }
  /** An edit of this app sent. */
  async function edit(doc: string, fn: () => void) {
    const before = Y.encodeStateVector(y)
    fn()
    await client.request('doc.update', { doc, update: b64(Y.encodeStateAsUpdate(y, before)) })
  }
  const applyRemote = () => {
    for (const e of events.splice(0)) if (e.e === 'doc.update') Y.applyUpdate(y, bytes(e.p.update), 'remote')
  }
  return { client, events, y, text, open, edit, applyRemote, id: () => client.state.device!.id }
}

/** An app's note shared (its document as the app has it). */
async function shareNote(a: Awaited<ReturnType<typeof app>>, title: string) {
  const r = await a.client.request('space.share', { title, update: b64(Y.encodeStateAsUpdate(a.y)) })
  return { space: r.space, doc: r.doc! }
}

describe('a shared document', () => {
  it('shared, joined by code, edited by both at once — the same text at both and on the server', async () => {
    const a = await app('Альфа')
    const b = await app('Бета')
    a.text.insert(0, 'Привет мир')
    const { space, doc } = await shareNote(a, 'Заметка')
    expect(space).toMatchObject({ title: 'Заметка', role: 'owner', docs: [{ id: doc, title: 'Заметка' }] })
    await expect(b.client.request('doc.open', { doc, sv: '' })).rejects.toMatchObject({ code: 'denied' })

    const { code } = await a.client.request('space.invite', { space: space.id, role: 'editor' })
    expect(code).toMatch(/^[A-Z2-9]{8}$/)
    const joined = await b.client.request('space.join', { code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` })
    expect(joined.role).toBe('editor')
    expect(joined.members.map((m) => m.role)).toEqual(['owner', 'editor'])
    await until(() => a.events.some((e) => e.e === 'space.changed' && e.p.members.length === 2))

    await a.open(doc)
    const opened = await b.open(doc)
    expect(opened.role).toBe('editor')
    expect(b.text.toString()).toBe('Привет мир')
    await until(() => a.events.some((e) => e.e === 'doc.presence' && e.p.devices.length === 2))

    // at the same moment: both edit before seeing the other's edit
    await Promise.all([a.edit(doc, () => a.text.insert(0, 'А: ')), b.edit(doc, () => b.text.insert(b.text.length, ' — Б'))])
    await until(() => a.events.some((e) => e.e === 'doc.update') && b.events.some((e) => e.e === 'doc.update'))
    a.applyRemote()
    b.applyRemote()
    expect(a.text.toString()).toBe('А: Привет мир — Б')
    expect(b.text.toString()).toBe(a.text.toString())

    // the server's own copy, from the database after a merge into the state
    const store = new DocStore(db)
    const kept = await store.load(doc)
    expect(docText(kept.y)).toBe(a.text.toString())
    await store.compact(doc, kept.y)
    expect(docText((await store.load(doc)).y)).toBe(a.text.toString())
    a.client.stop()
    b.client.stop()
  }, 30_000)

  it('a reader cannot edit; the space\'s chat has its members; a member removed loses the space and its chats', async () => {
    const a = await app('Гамма')
    const b = await app('Дельта')
    a.text.insert(0, 'текст')
    const { space, doc } = await shareNote(a, 'Док')
    const { code } = await a.client.request('space.invite', { space: space.id, role: 'reader' })
    await b.client.request('space.join', { code })
    await b.open(doc)
    // (the app keeps a reader's editor read-only; the edit tried here is a copy's, not its document's)
    const fork = new Y.Doc()
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(b.y))
    const sv = Y.encodeStateVector(fork)
    fork.getText('text').insert(0, 'y')
    await expect(b.client.request('doc.update', { doc, update: b64(Y.encodeStateAsUpdate(fork, sv)) })).rejects.toMatchObject({ code: 'denied' })
    await expect(b.client.request('space.invite', { space: space.id, role: 'editor' })).rejects.toMatchObject({ code: 'denied' })
    await expect(b.client.request('space.chat', { space: space.id, title: 'Обсуждение' })).rejects.toMatchObject({ code: 'denied' })

    const room = await a.client.request('space.chat', { space: space.id, title: 'Обсуждение' })
    expect(room.members.map((m) => m.name).sort()).toEqual(['Гамма', 'Дельта'])
    await until(() => b.events.some((e) => e.e === 'chat.room' && e.p.id === room.id))
    // the reader made an editor: now edits
    await a.client.request('space.setRole', { space: space.id, device: b.id(), role: 'editor' })
    await b.edit(doc, () => b.text.insert(0, 'x'))

    // a third one joins later: gets the space's chat at once, and the whole text
    const c = await app('Эпсилон')
    const inv = await a.client.request('space.invite', { space: space.id, role: 'commenter' })
    await c.client.request('space.join', { code: inv.code })
    await until(() => c.events.some((e) => e.e === 'chat.room' && e.p.id === room.id))
    await c.open(doc)
    expect(c.text.toString()).toBe('xтекст')

    await a.client.request('space.remove', { space: space.id, device: c.id() })
    await until(() => c.events.some((e) => e.e === 'space.gone'))
    await expect(c.client.request('chat.history', { room: room.id })).rejects.toMatchObject({ code: 'denied' })
    await expect(c.client.request('doc.open', { doc, sv: '' })).rejects.toMatchObject({ code: 'denied' })

    // the owner leaves — the space is gone for everyone
    await a.client.request('space.leave', { space: space.id })
    await until(() => b.events.some((e) => e.e === 'space.gone'))
    expect(await b.client.request('space.list', {})).toEqual([])
    for (const x of [a, b, c]) x.client.stop()
  }, 30_000)

  it('a shared folder: notes added (a taken name — « (2)»), moved, deleted and brought back; everyone told', async () => {
    const a = await app('Альфа-папка')
    const b = await app('Бета-папка')
    const first = (t: string) => {
      const y = new Y.Doc()
      y.getText('text').insert(0, t)
      return b64(Y.encodeStateAsUpdate(y))
    }
    const { space, doc } = await a.client.request('space.share', { title: 'Проекты', kind: 'folder' })
    expect(doc).toBeUndefined()
    expect(space).toMatchObject({ kind: 'folder', docs: [] })
    const { code } = await a.client.request('space.invite', { space: space.id, role: 'editor' })
    await b.client.request('space.join', { code })

    const one = await a.client.request('space.addDoc', { space: space.id, path: 'Идеи/План.md', update: first('план') })
    const two = await b.client.request('space.addDoc', { space: space.id, path: 'Идеи/план.md', update: first('ещё') })
    expect([one.path, two.path]).toEqual(['Идеи/План.md', 'Идеи/план (2).md'])
    await expect(a.client.request('space.addDoc', { space: space.id, path: '../вне.md', update: first('x') })).rejects.toMatchObject({ code: 'bad' })
    await until(() => b.events.some((e) => e.e === 'space.changed' && e.p.docs.length === 2))

    expect(await a.client.request('space.moveDoc', { doc: two.doc, path: 'Архив/План.md' })).toEqual({ path: 'Архив/План.md' })
    await a.client.request('space.deleteDoc', { doc: one.doc })
    const listed = (await b.client.request('space.list', {})).find((s) => s.id === space.id)!
    expect(listed.docs.map((d) => [d.path, !!d.deleted])).toEqual([['Архив/План.md', false], ['Идеи/План.md', true]])
    // deleted, yet it may be opened (to bring it back) — and brought back to its place
    expect((await b.open(one.doc)).role).toBe('editor')
    expect(await b.client.request('space.restoreDoc', { doc: one.doc })).toEqual({ path: 'Идеи/План.md' })
    a.client.stop()
    b.client.stop()
  }, 30_000)

  it('media: sent once with a pass, fetched by a member; no pass, a reader\'s send, a foreign path — refused', async () => {
    const a = await app('Гамма-медиа')
    const b = await app('Дельта-медиа')
    a.text.insert(0, 'x')
    const { space } = await a.client.request('space.share', { title: 'С картинкой', update: b64(Y.encodeStateAsUpdate(a.y)) })
    const { code } = await a.client.request('space.invite', { space: space.id, role: 'reader' })
    await b.client.request('space.join', { code })
    const rel = '.images/2026-10-24-abcdef12.png'
    const url = `http://127.0.0.1:${server.port}/media/${space.id}/${rel}`
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    expect(await a.client.request('media.missing', { space: space.id, rels: [rel, 'не путь'] })).toEqual([rel])

    const ta = (await a.client.request('media.ticket', { space: space.id })).ticket
    expect((await fetch(url, { method: 'PUT', body: png })).status).toBe(403)
    expect((await fetch(url, { method: 'PUT', body: png, headers: { 'x-qa-ticket': ta } })).status).toBe(204)
    expect(await a.client.request('media.missing', { space: space.id, rels: [rel] })).toEqual([])

    const tb = (await b.client.request('media.ticket', { space: space.id })).ticket
    const got = await fetch(url, { headers: { 'x-qa-ticket': tb } })
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png)
    expect((await fetch(url.replace('abcdef12', 'abcdef13'), { method: 'PUT', body: png, headers: { 'x-qa-ticket': tb } })).status).toBe(403)
    expect((await fetch(`http://127.0.0.1:${server.port}/media/${space.id}/../secret.png`, { headers: { 'x-qa-ticket': tb } })).status).toBe(400)
    // a pass is of its space only
    const other = await a.client.request('space.share', { title: 'Другой', update: b64(Y.encodeStateAsUpdate(a.y)) })
    expect((await fetch(url.replace(space.id, other.space.id), { headers: { 'x-qa-ticket': ta } })).status).toBe(403)
    a.client.stop()
    b.client.stop()
  }, 30_000)

  it('cursors: passed to the others who have the note open (never kept); one who opens it sees them; one who leaves — gone', async () => {
    const a = await app('Альфа-курсоры')
    const b = await app('Бета-курсоры')
    const c = await app('Гамма-курсоры')
    a.text.insert(0, 'Привет, мир')
    const { space, doc } = await shareNote(a, 'Курсоры')
    for (const x of [b, c]) await x.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'reader' })).code })
    await a.open(doc)
    await b.open(doc)
    const t = new SharedText()
    t.setLocal('Привет, мир')
    const sel = { ...t.anchor(3, 3), caretAtStart: false }
    // not open by this device — nothing told
    expect(await c.client.request('doc.cursor', { doc, sel })).toBeNull()
    await a.client.request('doc.cursor', { doc, sel })
    await until(() => b.events.some((e) => e.e === 'doc.cursor' && e.p.device.name === 'Альфа-курсоры' && e.p.sel?.start === sel.start))
    expect(c.events.some((e) => e.e === 'doc.cursor')).toBe(false)
    await expect(a.client.request('doc.cursor', { doc, sel: { start: 'x y', end: '', caretAtStart: 1 } as never })).rejects.toMatchObject({ code: 'bad' })
    // one opening it now sees the cursor there is
    await c.open(doc)
    await until(() => c.events.some((e) => e.e === 'doc.cursor' && e.p.device.name === 'Альфа-курсоры'))
    // its owner leaves — gone for the others
    await a.client.request('doc.close', { doc })
    await until(() => b.events.some((e) => e.e === 'doc.cursor' && e.p.device.name === 'Альфа-курсоры' && e.p.sel === null))
    for (const x of [a, b, c]) x.client.stop()
  }, 30_000)

  it('the server\'s clock is told when a device signs in (the app keeps how far its own one is)', async () => {
    const before = Date.now()
    const a = await app('Альфа-часы')
    expect(a.client.state.skew).toBeDefined()
    expect(Math.abs(a.client.state.skew!)).toBeLessThan(5_000)
    expect(Date.now() + a.client.state.skew!).toBeGreaterThanOrEqual(before - 5_000)
    a.client.stop()
  }, 30_000)

  it('a shared note\'s chats follow its roles: a reader reads, may not write, react or bring others in', async () => {
    const a = await app('Альфа-роли')
    const b = await app('Бета-роли')
    const c = await app('Гамма-роли')
    const { space } = await a.client.request('space.share', { title: 'Роли', update: b64(Y.encodeStateAsUpdate(a.y)) })
    await b.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'reader' })).code })
    await c.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'commenter' })).code })
    const room = (await a.client.request('space.chat', { space: space.id, title: 'Обсуждение' })).id
    const m = await a.client.request('chat.send', { room, text: 'Привет', clientId: 'r1' })
    // a reader: the history — yes; writing, reacting, «печатает…» — no
    expect((await b.client.request('chat.history', { room })).map((x) => x.text)).toEqual(['Привет'])
    await expect(b.client.request('chat.send', { room, text: 'Можно?', clientId: 'r2' })).rejects.toMatchObject({ code: 'denied' })
    await expect(b.client.request('chat.react', { room, seq: m.seq, emoji: '👍', on: true })).rejects.toMatchObject({ code: 'denied' })
    await expect(b.client.request('chat.typing', { room })).rejects.toMatchObject({ code: 'denied' })
    // a commenter writes
    expect((await c.client.request('chat.send', { room, text: 'Да', clientId: 'r3' })).text).toBe('Да')
    // a shared note's chat has the note's people only
    const outsider = await app('Дельта-роли')
    await expect(a.client.request('chat.add', { room, device: outsider.id(), as: 'branch' })).rejects.toMatchObject({ code: 'denied' })
    for (const x of [a, b, c, outsider]) x.client.stop()
  }, 30_000)

  it('a chat made by the app\'s own id (made offline): made again — the same one; someone else\'s id — refused', async () => {
    const a = await app('Альфа-офлайн')
    const b = await app('Бета-офлайн')
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5'
    const first = await a.client.request('chat.create', { id, title: 'Без сервера' })
    expect(first).toMatchObject({ id, title: 'Без сервера' })
    // the app sends it again (it did not hear the answer) — the same chat, not a second one
    expect((await a.client.request('chat.create', { id, title: 'Без сервера' })).id).toBe(id)
    expect((await a.client.request('chat.rooms', {})).filter((r) => r.id === id)).toHaveLength(1)
    await expect(b.client.request('chat.create', { id, title: 'Чужой' })).rejects.toMatchObject({ code: 'denied' })
    a.client.stop()
    b.client.stop()
  }, 30_000)

  it('a chat\'s files: sent by a member, fetched by another (kept after), a message carries only its room\'s file; others refused', async () => {
    const a = await app('Альфа-файлы')
    const b = await app('Бета-файлы')
    const c = await app('Гамма-файлы')
    const { space } = await a.client.request('space.share', { title: 'Общая', update: b64(Y.encodeStateAsUpdate(a.y)) })
    await b.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'reader' })).code })
    const room = (await a.client.request('chat.create', { title: 'С файлами' })).id
    await a.client.request('chat.add', { room, device: b.id(), as: 'branch' })
    const base = () => `http://127.0.0.1:${server.port}`
    const filesOf = (x: Awaited<ReturnType<typeof app>>) =>
      new ChatFiles(new SpacePasses(async (r) => (await x.client.request('chat.fileTicket', { room: r })).ticket), base, mkdtempSync(join(tmpdir(), 'qa-chat-files-')))
    const fa = filesOf(a)
    const fb = filesOf(b)
    const bytes = new TextEncoder().encode('строки отчёта')
    const file = await fa.put(room, 'C:\\папка\\Отчёт за день.txt', 'text/plain', bytes)
    expect(file).toMatchObject({ name: 'Отчёт за день.txt', size: bytes.length, mime: 'text/plain' })
    const m = await a.client.request('chat.send', { room, text: '', clientId: 'f1', attach: { kind: 'file', title: file.name, data: file } })
    expect(m.attach?.data).toEqual(file)
    expect(await fb.get(room, file.id)).toEqual(bytes)
    // kept: shown again without the server
    expect(await new ChatFiles(new SpacePasses(async () => 'x'), () => undefined, (fb as unknown as { dir: string }).dir).get(room, file.id)).toEqual(bytes)

    // a file of no room / another room — not carried; one not a member — no pass, no bytes
    const stray = { ...file, id: '00000000-0000-4000-8000-000000000000' }
    await expect(a.client.request('chat.send', { room, text: '', clientId: 'f2', attach: { kind: 'image', title: 'x', data: stray } })).rejects.toThrow(/не найден/)
    const other = (await a.client.request('chat.create', {})).id
    await expect(a.client.request('chat.send', { room: other, text: '', clientId: 'f3', attach: { kind: 'file', title: 'x', data: file } })).rejects.toThrow(/не найден/)
    await expect(c.client.request('chat.fileTicket', { room })).rejects.toThrow(/доступа/)
    expect((await fetch(`${base()}/chat-files/${room}/${file.id}`)).status).toBe(403)
    const ticketA = (await a.client.request('chat.fileTicket', { room: other })).ticket
    expect((await fetch(`${base()}/chat-files/${room}/${file.id}`, { headers: { 'x-qa-ticket': ticketA } })).status).toBe(403)
    a.client.stop()
    b.client.stop()
    c.client.stop()
  }, 30_000)

  it('run results: ordered by the server — revisions, its time; a send over an old revision refused with the newer one; a reader may not send', async () => {
    const a = await app('Альфа-результаты')
    const b = await app('Бета-результаты')
    const c = await app('Гамма-результаты')
    a.text.insert(0, '```sql\nselect 1\n```')
    const { space, doc } = await shareNote(a, 'Запросы')
    await b.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'reader' })).code })
    await c.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'editor' })).code })
    const url = `http://127.0.0.1:${server.port}/results/${space.id}/${doc}`
    const pass = async (x: typeof a) => (await x.client.request('media.ticket', { space: space.id })).ticket
    const [ta, tb, tc] = [await pass(a), await pass(b), await pass(c)]
    const put = async (t: string, changes: Record<string, { value: unknown; base: number }>) => {
      const r = await fetch(url, { method: 'PUT', body: JSON.stringify({ changes }), headers: { 'x-qa-ticket': t } })
      return { status: r.status, reply: r.status === 200 ? ((await r.json()) as { accepted: Record<string, number>; current: Record<string, { value: { rows?: number } | null; seq: number }> }) : undefined }
    }
    const get = async (t: string, since = 0) => (await (await fetch(`${url}?since=${since}`, { headers: { 'x-qa-ticket': t } })).json()) as { seq: number; entries: Record<string, { value: { rows?: number; at: number } | null; by: string; at: number; seq: number }> }

    // the first one: taken at the server's time (whatever the device's clock said)
    const before = Date.now()
    const first = await put(ta, { 'run:q': { value: { rows: 1, at: 9_999_999_999_999 }, base: 0 }, 'ctx:n': { value: { value: 1 }, base: 0 } })
    expect(Object.keys(first.reply!.accepted).sort()).toEqual(['ctx:n', 'run:q'])
    await until(() => b.events.some((e) => e.e === 'doc.results' && e.p.doc === doc))
    const page = await get(tb)
    expect(page.entries['run:q']).toMatchObject({ by: 'Альфа-результаты', value: { rows: 1 } })
    expect(page.entries['run:q'].at).toBeGreaterThanOrEqual(before - 5_000)
    expect(page.entries['run:q'].at).toBeLessThan(before + 60_000)
    const rev = page.entries['run:q'].seq

    // Гамма runs it over that revision — taken; Альфа's run made offline over the old one — refused, Гамма's answered
    expect(Object.keys((await put(tc, { 'run:q': { value: { rows: 2, at: 1 }, base: rev } })).reply!.accepted)).toEqual(['run:q'])
    const late = await put(ta, { 'run:q': { value: { rows: 3, at: 2 }, base: rev } })
    expect(late.reply!.accepted).toEqual({})
    expect(late.reply!.current['run:q'].value).toMatchObject({ rows: 2 })
    // taken away over the newest — gone for everyone
    await put(ta, { 'ctx:n': { value: null, base: page.entries['ctx:n'].seq } })
    const next = await get(tb, page.seq)
    expect(Object.keys(next.entries).sort()).toEqual(['ctx:n', 'run:q'])
    expect(next.entries['ctx:n'].value).toBeNull()
    expect(next.entries['run:q'].value).toMatchObject({ rows: 2 })

    expect((await put(tb, { 'run:q': { value: { rows: 9, at: 1 }, base: 999 } })).status).toBe(403)
    expect((await fetch(url, { headers: { 'x-qa-ticket': 'no-pass' } })).status).toBe(403)
    for (const x of [a, b, c]) x.client.stop()
  }, 30_000)

  it('a picture through the app\'s own code: sent by the author, the others told, fetched by them; a stale pass — asked anew', async () => {
    const a = await app('Альфа-картинка')
    const b = await app('Бета-картинка')
    const rel = '.images/2026-10-24-0a1b2c3d.png'
    a.text.insert(0, `![[${rel}]]`)
    const { space } = await shareNote(a, 'С картинкой')
    const { code } = await a.client.request('space.invite', { space: space.id, role: 'editor' })
    await b.client.request('space.join', { code })
    /** A notebook's pictures in memory (what the app's vault would read and write). */
    const vault = (files: Record<string, Uint8Array>) =>
      ({
        root: '',
        readImage: (r: string) => files[r] ?? (() => { throw new Error('нет') })(),
        restoreImage: (r: string, bytes: Uint8Array) => void (files[r] = bytes),
      }) as unknown as ConstructorParameters<typeof SharedMedia>[0]
    const base = () => `http://127.0.0.1:${server.port}`
    const media = (c: typeof a, files: Record<string, Uint8Array>, stale = false) => {
      let first = stale
      const passes = new SpacePasses(async (s) => (first ? ((first = false), 'stale.pass.0.x') : (await c.client.request('media.ticket', { space: s })).ticket))
      return new SharedMedia(vault(files), (m, p) => c.client.request(m, p), passes, base)
    }
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9])
    const hers: Record<string, Uint8Array> = {}
    // before the author sent it: nothing to fetch yet — absent (its coming is an event), not a failure to retry
    const early = await media(b, hers).sync(space.id, [rel])
    expect(early).toEqual({ fetched: [], absent: [rel], failed: {} })
    expect((await media(a, { [rel]: png }, true).sync(space.id, [rel])).failed).toEqual({})
    await until(() => b.events.some((e) => e.e === 'media.added' && e.p.rels.includes(rel)))
    expect((await media(b, hers, true).sync(space.id, [rel])).fetched).toEqual([rel])
    expect(hers[rel]).toEqual(png)
    a.client.stop()
    b.client.stop()
  }, 30_000)

  it('comments: on a place of the note, seen by all members, answered, solved; a reader may not comment, a commenter may', async () => {
    const a = await app('Альфа-комментарии')
    const b = await app('Бета-комментарии')
    const c = await app('Гамма-комментарии')
    a.text.insert(0, 'первая строка\nвторая строка')
    const { space, doc } = await shareNote(a, 'Обсуждаемая')
    await b.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'commenter' })).code })
    await c.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'reader' })).code })
    const anchor = { start: 'AAEC', end: 'AAED', quote: 'вторая строка' }

    const room = await b.client.request('space.comment', { doc, anchor, text: 'Уточнить формулировку', clientId: 'k1' })
    expect(room).toMatchObject({ doc, anchor, resolved: false, title: 'вторая строка', lastSeq: 1 })
    await until(() => a.events.some((e) => e.e === 'chat.room' && e.p.id === room.id))
    await until(() => a.events.some((e) => e.e === 'chat.message' && e.p.room === room.id))
    await a.client.request('chat.send', { room: room.id, text: 'Согласен', clientId: 'k2' })
    expect((await c.client.request('chat.history', { room: room.id })).map((m) => m.text)).toEqual(['Уточнить формулировку', 'Согласен'])
    await expect(c.client.request('space.comment', { doc, anchor, text: 'x', clientId: 'k3' })).rejects.toMatchObject({ code: 'denied' })
    await expect(a.client.request('space.comment', { doc, anchor: { start: '../x', end: 'A', quote: '' }, text: 'x', clientId: 'k4' })).rejects.toMatchObject({ code: 'bad' })

    // reactions: put, seen by the others, taken back; a foreign emoji refused
    const reacted = await a.client.request('chat.react', { room: room.id, seq: 1, emoji: '👍', on: true })
    expect(reacted.reactions?.['👍']?.map((d) => d.name)).toEqual(['Альфа-комментарии'])
    await until(() => b.events.some((e) => e.e === 'chat.edited' && e.p.seq === 1))
    expect((await a.client.request('chat.react', { room: room.id, seq: 1, emoji: '👍', on: false })).reactions).toBeUndefined()
    await expect(a.client.request('chat.react', { room: room.id, seq: 1, emoji: 'x', on: true })).rejects.toMatchObject({ code: 'bad' })
    // a mention: kept for the members only (a stranger's id dropped), the mentioned one told
    const said = await a.client.request('chat.send', { room: room.id, text: '@Бета-комментарии глянь', clientId: 'k5', mentions: [b.id(), 'чужой'] })
    expect(said.mentions).toEqual([b.id()])
    await until(() => b.events.some((e) => e.e === 'chat.message' && !!e.p.mentions?.includes(b.id())))

    expect(await b.client.request('space.resolve', { room: room.id, resolved: true })).toMatchObject({ resolved: true })
    await until(() => a.events.some((e) => e.e === 'chat.room' && e.p.id === room.id && e.p.resolved === true))
    expect((await a.client.request('space.resolve', { room: room.id, resolved: false })).resolved).toBe(false)
    for (const x of [a, b, c]) x.client.stop()
  }, 30_000)

  it('a wrong code, a broken update — refused', async () => {
    const a = await app('Зета')
    await expect(a.client.request('space.join', { code: 'AAAA-BBBB' })).rejects.toMatchObject({ code: 'missing' })
    await expect(a.client.request('space.share', { title: 'x', update: 'не данные' })).rejects.toMatchObject({ code: 'bad' })
    await expect(a.client.request('space.share', { title: '  ', update: b64(Y.encodeStateAsUpdate(new Y.Doc())) })).rejects.toMatchObject({ code: 'bad' })
    a.client.stop()
  }, 20_000)
})
