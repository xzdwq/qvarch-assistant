import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket as WsSocket } from 'ws'
import { TransportClient, type ClientState } from '../../src/main/transport/client'
import { makeKeys, signerOf, type DeviceKeys } from '../../src/main/transport/keys'
import { TRANSPORT_PATH, type TransportEvent } from '../../src/shared/transport/protocol'
import type { ServerConfig } from '../src/config'
import { Db } from '../src/db'
import { startTransport, type Transport } from '../src/hub'
import { MODULES } from '../src/modules'
import * as Y from 'yjs'
import { startPg } from './pg'

/**
 * The server as the app meets it: a real PostgreSQL (embedded, its own folder and port), the server's modules, the
 * app's own client. Signing in by key, the access code, a chat of one's own, people added, branches, renaming, the rights.
 */
/** A condition met within a time (checked every 50 ms). */
async function until(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('не дождались')
    await new Promise((r) => setTimeout(r, 50))
  }
}

let pg: Awaited<ReturnType<typeof startPg>>
let db: Db
let server: Transport
const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({ port: 0, databaseUrl: '', accessCode: '', version: 'test', ...over })

beforeAll(async () => {
  pg = await startPg()
  db = new Db(pg.url)
  server = await startTransport(config({ databaseUrl: pg.url }), db, MODULES)
  // (a database started while the whole run loads the machine may take a while)
}, 120_000)
afterAll(async () => {
  await server?.close()
  await db?.close()
  await pg?.stop()
})

/** An app connected: its states and the events it got. */
function app(name: string, keys: DeviceKeys = makeKeys(), code = '', port = server.port) {
  const states: ClientState[] = []
  const events: TransportEvent[] = []
  const client = new TransportClient({ url: `ws://127.0.0.1:${port}${TRANSPORT_PATH}`, name: () => name, signer: signerOf(keys, () => code), onState: (s) => states.push(s), onEvent: (e) => events.push(e) })
  client.start()
  const messages = () => events.flatMap((e) => (e.e === 'chat.message' ? [e.p] : []))
  return { client, states, events, keys, messages, online: () => until(() => client.state.status === 'online') }
}

describe('the transport server', () => {
  it('a device signed in by its key: the same key — the same device; a chat of one\'s own, numbered messages, a resend once, history', async () => {
    const a = app('Альфа')
    await a.online()
    expect(a.client.state.device).toMatchObject({ name: 'Альфа' })
    const id = a.client.state.device?.id
    const room = (await a.client.request('chat.create', {})).id
    const sent = await a.client.request('chat.send', { room, text: '  Привет  ', clientId: 'c1' })
    expect(sent).toMatchObject({ seq: 1, text: 'Привет', clientId: 'c1' })
    expect((await a.client.request('chat.send', { room, text: 'Привет', clientId: 'c1' })).seq).toBe(1)
    await a.client.request('chat.send', { room, text: 'второе', clientId: 'c2' })
    await a.client.request('chat.send', { room, text: '', clientId: 'c3', attach: { kind: 'value', title: 'Итог', data: { n: 1 } } })
    expect((await a.client.request('chat.history', { room })).map((m) => [m.seq, m.attach?.title ?? m.text])).toEqual([[1, 'Привет'], [2, 'второе'], [3, 'Итог']])
    expect((await a.client.request('chat.history', { room, before: 3, limit: 1 })).map((m) => m.seq)).toEqual([2])
    await expect(a.client.request('chat.send', { room, text: '', clientId: 'c4' })).rejects.toMatchObject({ code: 'bad' })
    a.client.stop()
    const again = app('Альфа', a.keys)
    await again.online()
    expect(again.client.state.device?.id).toBe(id)
    expect((await again.client.request('chat.rooms', {})).map((r) => r.id)).toContain(room)
    again.client.stop()
  }, 20_000)

  it('people added to one\'s chat: the first chat of two is their main one, a later one — its branch, or the main one goes on', async () => {
    const a = app('Бета')
    const b = app('Гамма')
    const stranger = app('Дельта')
    await Promise.all([a.online(), b.online(), stranger.online()])
    // they share a note: now they know each other
    const y = new Y.Doc()
    y.getText('text').insert(0, 'x')
    const { space } = await a.client.request('space.share', { title: 'Общее', update: Buffer.from(Y.encodeStateAsUpdate(y)).toString('base64') })
    await b.client.request('space.join', { code: (await a.client.request('space.invite', { space: space.id, role: 'editor' })).code })
    const bId = b.client.state.device!.id
    expect((await a.client.request('chat.people', {})).map((d) => d.name)).toEqual(['Гамма'])
    await expect(a.client.request('chat.add', { room: (await a.client.request('chat.create', {})).id, device: stranger.client.state.device!.id, as: 'branch' })).rejects.toMatchObject({ code: 'denied' })

    // the first chat with Гамма: their main one
    const first = await a.client.request('chat.create', { title: 'Первый' })
    expect(await a.client.request('chat.main', { device: bId })).toBeNull()
    const main = await a.client.request('chat.add', { room: first.id, device: bId, as: 'branch' })
    expect(main).toMatchObject({ id: first.id, title: 'Первый' })
    expect(main.parent).toBeUndefined()
    await until(() => b.events.some((e) => e.e === 'chat.room' && e.p.id === first.id))
    expect((await a.client.request('chat.main', { device: bId }))?.id).toBe(first.id)
    // a later one: a branch of it
    const second = await a.client.request('chat.create', { title: 'Ветка' })
    expect((await a.client.request('chat.add', { room: second.id, device: bId, as: 'branch' })).parent).toBe(first.id)
    // or the main one goes on: the lonely chat gives way
    const third = await a.client.request('chat.create', {})
    expect((await a.client.request('chat.add', { room: third.id, device: bId, as: 'main' })).id).toBe(first.id)
    expect((await a.client.request('chat.rooms', {})).some((r) => r.id === third.id)).toBe(false)

    // renamed by its maker only
    await expect(b.client.request('chat.rename', { room: first.id, title: 'Чужое' })).rejects.toMatchObject({ code: 'denied' })
    expect((await a.client.request('chat.rename', { room: first.id, title: 'Главный' })).title).toBe('Главный')
    await until(() => b.events.some((e) => e.e === 'chat.room' && e.p.title === 'Главный'))
    // a stranger may not read it
    await expect(stranger.client.request('chat.history', { room: first.id })).rejects.toMatchObject({ code: 'denied' })
    for (const x of [a, b, stranger]) x.client.stop()
  }, 30_000)

  it('the access code: a wrong one refused for good, the right one let in', async () => {
    const coded = await startTransport(config({ databaseUrl: '', accessCode: 'secret' }), db, MODULES)
    try {
      const wrong = app('Зета', makeKeys(), 'wrong', coded.port)
      await until(() => wrong.client.state.status === 'error')
      expect(wrong.client.state.message).toMatch(/код доступа/)
      await new Promise((r) => setTimeout(r, 1500))
      expect(wrong.states.filter((s) => s.status === 'connecting')).toHaveLength(1)
      wrong.client.stop()
      const right = app('Зета', makeKeys(), 'secret', coded.port)
      await right.online()
      right.client.stop()
    } finally {
      await coded.close()
    }
  }, 20_000)

  it('a foreign protocol version or a wrong signature: refused', async () => {
    const tryAuth = (frame: (nonce: string) => object) =>
      new Promise<string>((ok) => {
        const ws = new WsSocket(`ws://127.0.0.1:${server.port}${TRANSPORT_PATH}`)
        ws.on('message', (d) => {
          const f = JSON.parse(String(d))
          if (f.t === 'hello') ws.send(JSON.stringify(frame(f.nonce)))
          if (f.t === 'fail') ok(f.code)
        })
      })
    const keys = makeKeys()
    const s = signerOf(keys, () => '')
    expect(await tryAuth((n) => ({ t: 'auth', v: 99, key: keys.publicKey, sig: s.sign(n), proof: '', name: '' }))).toBe('version')
    expect(await tryAuth(() => ({ t: 'auth', v: 1, key: keys.publicKey, sig: s.sign('другой вызов'), proof: '', name: '' }))).toBe('auth')
    expect(await tryAuth(() => ({ t: 'req', id: 1, m: 'chat.rooms', p: {} }))).toBe('auth')
  })
})
