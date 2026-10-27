import { CHAIN_LIMIT, CHAT_PAGE, CHAT_TITLE, cleanChatText, HISTORY_MAX, isAttach, isFileKind, isReaction, TITLE_MAX, type ChatAttach, type ChatHistoryItem, type ChatMessage } from '../../../../src/shared/transport/chat'
import type { DeviceInfo } from '../../../../src/shared/transport/protocol'
import { int, RpcFail, text, uuid, type ModuleFactory, type ServerContext, type Session } from '../../module'
import { ticketOf } from '../../tickets'
import { ChatFiles, CHAT_FILES_MIGRATION } from './chatFiles'
import { ChatPeople } from './chatPeople'
import { CHAT_BRANCHES_MIGRATION, CHAT_MIGRATIONS, CHAT_REACTIONS_MIGRATION, CHAT_REPLY_MIGRATION, ChatStore, type AgentStamp, type RoomPlace } from './chatStore'
import { AGENT_NAME_MAX, ChatAgents, CHAT_AGENT_OPEN_MIGRATION, CHAT_AGENTS_MIGRATION } from './chatAgents'

const CLIENT_ID_MAX = 64

/** The chat as the modules use it: a message posted reaches the members online and the bus; a new room — its members. */
export class Chat {
  readonly store: ChatStore
  readonly agents: ChatAgents
  constructor(private readonly ctx: ServerContext) {
    this.store = new ChatStore(ctx.db)
    this.agents = new ChatAgents(ctx.db)
  }

  /**
   * A message posted (by an agent of the author's — `by`); `mentions` — the room's members and agents it mentions
   * (others are dropped, and the writer itself).
   */
  async post(room: string, author: DeviceInfo, body: string, clientId?: string, mentions: readonly string[] = [], attach?: ChatAttach, by: AgentStamp = {}): Promise<ChatMessage> {
    const known = mentions.length ? new Set([...(await this.store.members(room)), ...(await this.agents.ids(room))]) : undefined
    const self = by.agent?.id ?? author.id
    const { message, fresh } = await this.store.post(room, author.id, body, clientId, known ? [...new Set(mentions)].filter((m) => known.has(m) && m !== self) : [], attach, by)
    if (fresh) {
      this.ctx.delivery.send(await this.store.members(room), { e: 'chat.message', p: message })
      this.ctx.bus.emit('chat.posted', message)
    }
    return message
  }
  /** A room opened (of a shared space — when given; a comment — its place): every member online gets it at once. */
  async open(title: string, createdBy: string, members: readonly string[], place: RoomPlace = {}): Promise<string> {
    const id = await this.store.createRoom(title, createdBy, members, place)
    await this.told(id)
    return id
  }
  /** Every member online gets the room as it is now (opened, solved…). */
  async told(room: string): Promise<void> {
    for (const m of await this.store.members(room)) {
      const r = await this.store.room(room, m)
      if (r) this.ctx.delivery.send([m], { e: 'chat.room', p: r })
    }
  }
  /** «Печатает…» to the room's other members (an agent working — to all of them, its owner too: on another window). */
  async typing(room: string, who: DeviceInfo, agent?: { id: string; name: string }): Promise<void> {
    const to = (await this.store.members(room)).filter((m) => agent || m !== who.id)
    this.ctx.delivery.send(to, { e: 'chat.typing', p: { room, device: who, ...(agent ? { agent } : {}) } })
  }
}

export const chatModule: ModuleFactory = (ctx) => {
  const chat = new Chat(ctx)
  const people = new ChatPeople(ctx.db)
  const files = new ChatFiles(ctx.db, (room, device) => chat.store.isMember(room, device))
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
    if (space && !(await ctx.spaceRules.mayChat(space, s.device.id))) throw new RpcFail('denied', 'Ваша роль в этой заметке — только чтение')
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
        if (!clientId || clientId.length > CLIENT_ID_MAX) throw new RpcFail('bad', 'clientId: от 1 до 64 символов')
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
        return (await chat.store.room(room, s.device.id))!
      },
      'chat.removeAgent': async (p, s) => {
        const room = await memberRoom(p, s)
        await chat.agents.remove(room, text(p, 'id'), s.device.id)
        await chat.told(room)
        return (await chat.store.room(room, s.device.id))!
      },
      'chat.agentOpen': async (p, s) => {
        const room = await memberRoom(p, s)
        if (!(await chat.agents.setOpen(room, text(p, 'id'), s.device.id, p.on === true))) throw new RpcFail('denied', 'Разрешить звать можно только своего ИИ')
        await chat.told(room)
        return (await chat.store.room(room, s.device.id))!
      },
      'chat.create': async (p, s) => {
        // made by the app's own id (offline at first): made again — the same chat, its maker's only
        const own = p.id === undefined ? undefined : uuid(p, 'id')
        let id = own
        if (own && (await people.makerOf(own)) !== undefined) {
          if (!(await chat.store.room(own, s.device.id))) throw new RpcFail('denied', 'Нет доступа к этому чату')
        } else {
          const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, TITLE_MAX) : CHAT_TITLE
          id = await chat.open(title, s.device.id, [s.device.id], { id: own })
        }
        // a chat kept on the app brought here: its agents, then its messages (sent again — each kept once)
        if ((await people.makerOf(id!)) === s.device.id) await importHistory(id!, p, s)
        return (await chat.store.room(id!, s.device.id))!
      },
      'chat.rename': async (p, s) => {
        const room = await memberRoom(p, s)
        if ((await people.makerOf(room)) !== s.device.id) throw new RpcFail('denied', 'Переименовать чат может только тот, кто его создал')
        await writableRoom(p, s)
        const title = text(p, 'title').trim().slice(0, TITLE_MAX)
        if (!title) throw new RpcFail('bad', 'Нужно название')
        await people.rename(room, title)
        await chat.told(room)
        return (await chat.store.room(room, s.device.id))!
      },
      'chat.people': (_p, s) => people.peopleOf(s.device.id),
      'chat.main': async (p, s) => {
        const main = await people.mainOf(s.device.id, text(p, 'device'))
        return main ? ((await chat.store.room(main, s.device.id)) ?? null) : null
      },
      'chat.add': async (p, s) => {
        const room = await memberRoom(p, s)
        if ((await chat.store.placeOf(room)).space) throw new RpcFail('denied', 'Это чат общей заметки: в нём её участники')
        const other = text(p, 'device')
        if (other === s.device.id || !(await people.peopleOf(s.device.id)).some((d) => d.id === other)) throw new RpcFail('denied', 'Этого человека нельзя добавить')
        const main = await people.mainOf(s.device.id, other)
        // the main conversation goes on: this chat (one's own alone) gives way to it
        if (p.as === 'main' && main && main !== room) {
          await people.dropLonely(room, s.device.id)
          return (await chat.store.room(main, s.device.id))!
        }
        await people.add(room, other)
        if (main && main !== room) await people.branchOf(room, main)
        await chat.told(room)
        return (await chat.store.room(room, s.device.id))!
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
        await chat.typing(room, s.device, (await agentStamp(room, { agent: p.agent }, s)).agent)
        return null
      },
      'chat.fileTicket': async (p, s) => ({ ticket: ticketOf(await memberRoom(p, s), s.device.id) }),
      'chat.read': async (p, s) => {
        await chat.store.read(await memberRoom(p, s), s.device.id, int(p, 'seq'))
        return null
      },
    },
  }
}
