import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TransportClient } from '../../src/main/transport/client'
import { makeKeys, signerOf } from '../../src/main/transport/keys'
import { TRANSPORT_PATH, type TransportEvent } from '../../src/shared/transport/protocol'
import { Db } from '../src/db'
import { startTransport, type Transport } from '../src/hub'
import { MODULES } from '../src/modules'
import { startPg } from './pg'

/**
 * The members' AI agents in a chat on a real PostgreSQL: put in by their owner only (a name made unique), writing by
 * their owner's connection only, mentioned like people, «работает» told to everyone; whether anyone may call them —
 * the chat's maker decides.
 */
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('не дождались')
    await new Promise((r) => setTimeout(r, 30))
  }
}

let pg: Awaited<ReturnType<typeof startPg>>
let db: Db
let server: Transport
beforeAll(async () => {
  pg = await startPg()
  db = new Db(pg.url)
  server = await startTransport({ port: 0, databaseUrl: pg.url, accessCode: '', version: 'test' }, db, MODULES)
}, 120_000)
afterAll(async () => {
  await server?.close()
  await db?.close()
  await pg?.stop()
})

async function app(name: string) {
  const events: TransportEvent[] = []
  const client = new TransportClient({ url: `ws://127.0.0.1:${server.port}${TRANSPORT_PATH}`, name: () => name, signer: signerOf(makeKeys(), () => ''), onState: () => undefined, onEvent: (e) => events.push(e) })
  client.start()
  await until(() => client.state.status === 'online')
  return { client, events, id: () => client.state.device!.id }
}

describe('agents in a chat', () => {
  it('put in by the owner, named apart, write by the owner only, mentioned like people; the maker opens them to all', async () => {
    const a = await app('Альфа')
    const b = await app('Бета')
    const room = (await a.client.request('chat.create', { title: 'С ИИ' })).id
    // (two who share a folder may add each other to a chat)
    const { space } = await a.client.request('space.share', { title: 'Папка', kind: 'folder' })
    const { code } = await a.client.request('space.invite', { space: space.id, role: 'editor' })
    await b.client.request('space.join', { code })
    await a.client.request('chat.add', { room, device: b.id(), as: 'branch' })
    const agentA = `${a.id()}:p1`
    const agentB = `${b.id()}:p1`
    await expect(a.client.request('chat.addAgent', { room, id: agentB, name: 'Чужой' })).rejects.toMatchObject({ code: 'denied' })
    await a.client.request('chat.addAgent', { room, id: agentA, name: 'ИИ' })
    // the same name — another one's: made unique
    const r = await b.client.request('chat.addAgent', { room, id: agentB, name: 'ИИ' })
    expect(r.agents?.map((x) => x.name)).toEqual(['ИИ', 'ИИ 2'])
    expect(r.agents?.some((x) => x.open)).toBe(false)

    // a person mentions the agent: kept as a mention like a person's
    const asked = await a.client.request('chat.send', { room, text: '@ИИ 2 посмотри', clientId: 'q1', mentions: [agentB] })
    expect(asked.mentions).toEqual([agentB])
    // the agent answers by its owner's connection; another's agent — refused
    await expect(a.client.request('chat.send', { room, text: 'не мой', clientId: 'q2', agent: agentB })).rejects.toMatchObject({ code: 'denied' })
    const answer = await b.client.request('chat.send', { room, text: 'Готово', clientId: 'q3', agent: agentB, chain: 1, mentions: [agentB, agentA] })
    expect(answer).toMatchObject({ agent: { id: agentB, name: 'ИИ 2' }, chain: 1, mentions: [agentA] })
    expect((await a.client.request('chat.history', { room })).at(-1)?.agent?.name).toBe('ИИ 2')

    // «работает…» of an agent — to everyone, its owner too
    await b.client.request('chat.typing', { room, agent: agentB })
    await until(() => a.events.some((e) => e.e === 'chat.typing' && e.p.agent?.id === agentB))
    await until(() => b.events.some((e) => e.e === 'chat.typing' && e.p.agent?.id === agentB))

    // each owner lets the others call their own agent only (off by default)
    await expect(b.client.request('chat.agentOpen', { room, id: agentA, on: true })).rejects.toMatchObject({ code: 'denied' })
    const opened = await a.client.request('chat.agentOpen', { room, id: agentA, on: true })
    expect(opened.agents?.map((x) => [x.id, !!x.open])).toEqual([
      [agentA, true],
      [agentB, false],
    ])
    // taken out by its owner only
    await a.client.request('chat.removeAgent', { room, id: agentB })
    expect((await b.client.request('chat.rooms', {})).find((x) => x.id === room)?.agents?.map((x) => x.id)).toEqual([agentA, agentB])
    expect((await b.client.request('chat.removeAgent', { room, id: agentB })).agents?.map((x) => x.id)).toEqual([agentA])
    a.client.stop()
    b.client.stop()
  }, 60_000)

  it('a chat kept on the app brought here: its agents and history in order, sent again — kept once; another\'s agents refused', async () => {
    const a = await app('Альфа-локально')
    const id = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
    const agent = `${a.id()}:p1`
    const history = [
      { clientId: 'h1', text: '@ИИ составь план', at: 1_000, mentions: [agent] },
      { clientId: 'h2', text: 'План готов', at: 2_000, agent, chain: 1 },
    ]
    const r = await a.client.request('chat.create', { id, title: 'Был локальным', agents: [{ id: agent, name: 'ИИ' }], history })
    expect(r.agents?.map((x) => x.id)).toEqual([agent])
    // the answer was lost: sent again — the same messages, not twice
    await a.client.request('chat.create', { id, title: 'Был локальным', agents: [{ id: agent, name: 'ИИ' }], history })
    const kept = await a.client.request('chat.history', { room: id })
    expect(kept.map((m) => [m.seq, m.text, m.agent?.id ?? null, m.at])).toEqual([
      [1, '@ИИ составь план', null, 1_000],
      [2, 'План готов', agent, 2_000],
    ])
    await expect(a.client.request('chat.create', { id: '2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', agents: [{ id: 'someone:p1', name: 'Чужой' }] })).rejects.toMatchObject({ code: 'bad' })
    a.client.stop()
  }, 60_000)

  it('an answer keeps the message it answers (its author, a piece of its text); a number of no message — no answer', async () => {
    const a = await app('Альфа-ответ')
    const room = (await a.client.request('chat.create', { title: 'Ответы' })).id
    const first = await a.client.request('chat.send', { room, text: 'Вопрос', clientId: 'q1' })
    const answer = await a.client.request('chat.send', { room, text: 'Ответ', clientId: 'q2', reply: first.seq })
    expect(answer.reply).toEqual({ seq: first.seq, author: 'Альфа-ответ', text: 'Вопрос' })
    const none = await a.client.request('chat.send', { room, text: 'Мимо', clientId: 'q3', reply: 999 })
    expect(none.reply).toBeUndefined()
    expect((await a.client.request('chat.history', { room })).find((m) => m.seq === answer.seq)?.reply?.text).toBe('Вопрос')
    a.client.stop()
  }, 60_000)
})
