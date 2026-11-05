import { CHAIN_LIMIT, CHAT_PAGE, CHAT_TITLE, cleanChatText, CLIENT_ID_MAX, HISTORY_MAX, isAttach, isChatAddMode, isFileKind, isReaction, TITLE_MAX, type ChatHistoryItem } from '../../../../src/shared/transport/chat'
import { ROLE_RIGHTS } from '../../../../src/shared/transport/space'
import { int, RpcFail, text, uuid, type ModuleFactory, type Session } from '../../module'
import { CHAT_FILES_MIGRATION, CHAT_FILES_SLIM_MIGRATION, ChatFiles } from './chatFiles'
import { ChatPeople } from './chatPeople'
import { Chat } from './chatRooms'
import { CHAT_BRANCHES_MIGRATION, CHAT_CLIENT_ID_MIGRATION, CHAT_MIGRATIONS, CHAT_PLACE_MIGRATION, CHAT_REACTIONS_MIGRATION, CHAT_REPLY_MIGRATION, type AgentStamp } from './chatStore'
import { AGENT_NAME_MAX, CHAT_AGENT_OPEN_MIGRATION, CHAT_AGENTS_MIGRATION } from './chatAgents'

export const chatModule: ModuleFactory = (ctx) => {
  const chat = new Chat(ctx)
  ctx.ports.provide('chatRooms', chat.port)
  const people = new ChatPeople(ctx.db)
  const files = new ChatFiles(ctx.db, ctx.tickets, (room, device) => chat.store.isMember(room, device))
  /** The people one may add to a chat: those of one's chats and of one's shared notes. */
  const peopleOf = async (device: string) => people.peopleOf(device, await ctx.ports.get('spaces').peersOf(device))
  /** The room of a request — only a member's. */
  async function memberRoom(p: Record<string, unknown>, s: Session): Promise<string> {
    const room = uuid(p, 'room')
    if (!(await chat.store.isMember(room, s.device.id))) throw new RpcFail('denied', 'Нет доступа к этому чату')
    return room
  }
  /** The room of a request — a member's who may write there (a shared space's: by the role in it). */
  async function writableRoom(p: Record<string, unknown>, s: Session): Promise<string> {
    const room = await memberRoom(p, s)
    const { space } = await chat.store.placeOf(room)
    const role = space && (await ctx.ports.get('spaces').roleOf(space, s.device.id))
    if (space && !(role && ROLE_RIGHTS[role].chat)) throw new RpcFail('denied', 'Ваша роль в этой заметке — только чтение')
    return room
  }
  /** Who writes, when an agent: one of the room's, of this device's (else refused); its chain step kept within limits. */
  async function agentStamp(room: string, p: Record<string, unknown>, s: Session): Promise<AgentStamp> {
    if (p.agent === undefined || p.agent === null) return {}
    const a = typeof p.agent === 'string' ? await chat.agents.of(room, p.agent) : undefined
    if (!a || a.owner !== s.device.id) throw new RpcFail('denied', 'Этого ИИ нет в чате')
    const chain = typeof p.chain === 'number' && Number.isInteger(p.chain) ? Math.min(Math.max(p.chain, 0), CHAIN_LIMIT) : 0
    return { agent: { id: a.id, name: a.name }, ...(chain ? { chain } : {}) }
  }
  /** The message an answer answers (a number of the room's; anything else — none). */
  const replyTo = (p: Record<string, unknown>): Pick<AgentStamp, 'reply'> => (typeof p.reply === 'number' && Number.isInteger(p.reply) && p.reply > 0 ? { reply: p.reply } : {})
  /** A chat's agents and history as the app kept it (only its maker's: their own messages and agents). */
  async function importHistory(room: string, p: Record<string, unknown>, s: Session): Promise<void> {
    const agents = Array.isArray(p.agents) ? p.agents.slice(0, 20) : []
    for (const a of agents as Array<{ id?: unknown; name?: unknown }>) {
      if (typeof a?.id !== 'string' || !a.id.startsWith(`${s.device.id}:`) || typeof a.name !== 'string' || !a.name.trim()) throw new RpcFail('bad', 'agents: свои ИИ с именами')
      await chat.agents.add(room, a.id, s.device.id, a.name.trim().slice(0, AGENT_NAME_MAX))
    }
    const history = Array.isArray(p.history) ? p.history : []
    if (history.length > HISTORY_MAX) throw new RpcFail('limit', `История больше ${HISTORY_MAX} сообщений`)
    const now = Date.now()
    for (const h of history as ChatHistoryItem[]) {
      const attach = h?.attach === undefined ? undefined : isAttach(h.attach) && !isFileKind(h.attach.kind) ? h.attach : null
      const body = attach && typeof h.text === 'string' && !h.text.trim() ? '' : cleanChatText(h?.text)
      const clientId = typeof h?.clientId === 'string' ? h.clientId.slice(0, CLIENT_ID_MAX) : ''
      if (attach === null || body === null || !clientId || typeof h.at !== 'number') throw new RpcFail('bad', 'history: сообщение не подходит')
      const stamp = await agentStamp(room, { agent: h.agent, chain: h.chain }, s)
      const mentions = Array.isArray(h.mentions) ? h.mentions.filter((m): m is string => typeof m === 'string').slice(0, 50) : []
      await chat.post(room, s.device, body, clientId, mentions, attach, { ...stamp, ...replyTo(h as unknown as Record<string, unknown>), at: Math.min(h.at, now) })
    }
  }
  /** The room as the caller sees it now. */
  const viewOf = async (room: string, s: Session) => (await chat.store.room(room, s.device.id))!
  return {
    name: 'chat',
    migrations: [
      ...CHAT_MIGRATIONS,
      CHAT_REACTIONS_MIGRATION,
      // the test bot is gone: its chats and itself taken away
      `delete from chat_rooms where id in (select room from chat_members where device = 'bot:test');
       delete from qa_devices where id = 'bot:test';`,
      CHAT_BRANCHES_MIGRATION,
      CHAT_FILES_MIGRATION,
      CHAT_AGENTS_MIGRATION,
      CHAT_REPLY_MIGRATION,
      // (migrations are numbered by their place: a new one goes last, always)
      CHAT_AGENT_OPEN_MIGRATION,
      CHAT_PLACE_MIGRATION,
      // never read: the room-wide switch replaced by each agent's own (`open`)
      'alter table chat_rooms drop column agents_open;',
      CHAT_FILES_SLIM_MIGRATION,
      CHAT_CLIENT_ID_MIGRATION,
    ],
    http: (req, res) => files.http(req, res),
    methods: {
      'chat.rooms': (_p, s) => chat.store.roomsOf(s.device.id),
      'chat.history': async (p, s) => {
        const room = await memberRoom(p, s)
        const before = p.before === undefined || p.before === null ? undefined : int(p, 'before')
        return chat.store.history(room, before, Math.min(Math.max(int(p, 'limit', CHAT_PAGE), 1), CHAT_PAGE * 4))
      },
      'chat.send': async (p, s) => {
        const room = await writableRoom(p, s)
        const attach = p.attach === undefined ? undefined : isAttach(p.attach) ? p.attach : null
        if (attach === null) throw new RpcFail('bad', 'Вложение не подходит (или больше 180 КБ)')
        if (attach && !(await files.attachFits(room, attach))) throw new RpcFail('bad', 'Файл не найден в этом чате — отправьте его заново')
        // a block's result may go with no words
        const body = attach && typeof p.text === 'string' && !p.text.trim() ? '' : cleanChatText(p.text)
        if (body === null) throw new RpcFail('bad', 'Пустое или слишком длинное сообщение')
        const clientId = text(p, 'clientId')
        if (!clientId || clientId.length > CLIENT_ID_MAX) throw new RpcFail('bad', `clientId: от 1 до ${CLIENT_ID_MAX} символов`)
        const mentions = Array.isArray(p.mentions) ? p.mentions.filter((m): m is string => typeof m === 'string').slice(0, 50) : []
        return chat.post(room, s.device, body, clientId, mentions, attach, { ...(await agentStamp(room, p, s)), ...replyTo(p) })
      },
      'chat.addAgent': async (p, s) => {
        const room = await writableRoom(p, s)
        const id = text(p, 'id')
        // (an agent's id is its owner's device and its profile: only the owner puts it in)
        if (!id.startsWith(`${s.device.id}:`) || id.length > s.device.id.length + 65) throw new RpcFail('denied', 'Добавить можно только своего ИИ')
        const name = text(p, 'name').trim().slice(0, AGENT_NAME_MAX)
        if (!name) throw new RpcFail('bad', 'Нужно имя ИИ')
        await chat.agents.add(room, id, s.device.id, name)
        await chat.told(room)
        return viewOf(room, s)
      },
      'chat.removeAgent': async (p, s) => {
        const room = await memberRoom(p, s)
        await chat.agents.remove(room, text(p, 'id'), s.device.id)
        await chat.told(room)
        return viewOf(room, s)
      },
      'chat.agentOpen': async (p, s) => {
        const room = await memberRoom(p, s)
        if (!(await chat.agents.setOpen(room, text(p, 'id'), s.device.id, p.on === true))) throw new RpcFail('denied', 'Разрешить звать можно только своего ИИ')
        await chat.told(room)
        return viewOf(room, s)
      },
      'chat.create': async (p, s) => {
        // made by the app's own id (offline at first): made again — the same chat, its maker's only
        const own = p.id === undefined ? undefined : uuid(p, 'id')
        let id = own
        if (own && (await people.makerOf(own)) !== undefined) {
          if (!(await chat.store.room(own, s.device.id))) throw new RpcFail('denied', 'Нет доступа к этому чату')
        } else {
          const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, TITLE_MAX) : CHAT_TITLE
          id = await chat.port.open({ title, by: s.device, members: [s.device.id], place: { id: own } })
        }
        // a chat kept on the app brought here: its agents, then its messages (sent again — each kept once). Only a
        // chat of the app's own: a shared note's chat is written by the roles in it, never by its maker's history
        const place = await chat.store.placeOf(id!)
        if ((await people.makerOf(id!)) === s.device.id && !place.space && !place.doc) await importHistory(id!, p, s)
        return viewOf(id!, s)
      },
      'chat.rename': async (p, s) => {
        const room = await writableRoom(p, s)
        if ((await people.makerOf(room)) !== s.device.id) throw new RpcFail('denied', 'Переименовать чат может только тот, кто его создал')
        const title = text(p, 'title').trim().slice(0, TITLE_MAX)
        if (!title) throw new RpcFail('bad', 'Нужно название')
        await people.rename(room, title)
        await chat.told(room)
        return viewOf(room, s)
      },
      'chat.people': (_p, s) => peopleOf(s.device.id),
      'chat.main': async (p, s) => {
        const main = await people.mainOf(s.device.id, text(p, 'device'))
        return main ? ((await chat.store.room(main, s.device.id)) ?? null) : null
      },
      'chat.add': async (p, s) => {
        const room = await memberRoom(p, s)
        if (!isChatAddMode(p.as)) throw new RpcFail('bad', 'as: ветка или основной разговор')
        if ((await chat.store.placeOf(room)).space) throw new RpcFail('denied', 'Это чат общей заметки: в нём её участники')
        const other = text(p, 'device')
        if (other === s.device.id || !(await peopleOf(s.device.id)).some((d) => d.id === other)) throw new RpcFail('denied', 'Этого человека нельзя добавить')
        const main = await people.mainOf(s.device.id, other)
        // the main conversation goes on: this chat (one's own alone) gives way to it
        if (p.as === 'main' && main && main !== room) {
          await people.dropLonely(room, s.device.id)
          return viewOf(main, s)
        }
        await people.add(room, other)
        if (main && main !== room) await people.branchOf(room, main)
        await chat.told(room)
        return viewOf(room, s)
      },
      'chat.leave': async (p, s) => {
        const room = await memberRoom(p, s)
        // (a shared note's chat and a comment go with their note — never one by one)
        const place = await chat.store.placeOf(room)
        if (place.space || place.doc) throw new RpcFail('denied', 'Это чат общей заметки: он уходит вместе с ней')
        const gone = await people.leave(room, s.device.id)
        // the others see who is left
        if (!gone) await chat.told(room)
        return { gone }
      },
      'chat.react': async (p, s) => {
        const room = await writableRoom(p, s)
        if (!isReaction(p.emoji)) throw new RpcFail('bad', 'Такой реакции нет')
        const m = await chat.store.react(room, int(p, 'seq'), s.device.id, p.emoji, p.on === true)
        if (!m) throw new RpcFail('missing', 'Сообщение не найдено')
        ctx.delivery.send(await chat.store.members(room), { e: 'chat.edited', p: m })
        return m
      },
      'chat.typing': async (p, s) => {
        const room = await writableRoom(p, s)
        const agent = (await agentStamp(room, { agent: p.agent }, s)).agent
        // «Печатает…» to the room's other members (an agent working — to all of them, its owner too: on another window)
        const to = (await chat.store.members(room)).filter((m) => agent || m !== s.device.id)
        ctx.delivery.send(to, { e: 'chat.typing', p: { room, device: s.device, ...(agent ? { agent } : {}) } })
        return null
      },
      'chat.fileTicket': async (p, s) => ({ ticket: ctx.tickets.issue(await memberRoom(p, s), s.device.id) }),
      'chat.read': async (p, s) => {
        await chat.store.read(await memberRoom(p, s), s.device.id, int(p, 'seq'))
        return null
      },
    },
  }
}
