import { CHAT_PAGE, CHAT_TITLE, cleanChatText, isAttach, isReaction, TITLE_MAX, type ChatAttach, type ChatMessage, type CommentAnchor } from '../../../../src/shared/transport/chat'
import type { DeviceInfo } from '../../../../src/shared/transport/protocol'
import { int, RpcFail, text, uuid, type ModuleFactory, type ServerContext, type Session } from '../../module'
import { ticketOf } from '../../tickets'
import { ChatFiles, CHAT_FILES_MIGRATION } from './chatFiles'
import { ChatPeople } from './chatPeople'
import { CHAT_BRANCHES_MIGRATION, CHAT_MIGRATIONS, CHAT_REACTIONS_MIGRATION, ChatStore } from './chatStore'

const CLIENT_ID_MAX = 64

/** The chat as the modules use it: a message posted reaches the members online and the bus; a new room — its members. */
export class Chat {
  readonly store: ChatStore
  constructor(private readonly ctx: ServerContext) {
    this.store = new ChatStore(ctx.db)
  }

  /** A message posted; `mentions` — the room's members it mentions (others are dropped). */
  async post(room: string, author: DeviceInfo, body: string, clientId?: string, mentions: readonly string[] = [], attach?: ChatAttach): Promise<ChatMessage> {
    const members = mentions.length ? new Set(await this.store.members(room)) : undefined
    const { message, fresh } = await this.store.post(room, author.id, body, clientId, members ? [...new Set(mentions)].filter((m) => members.has(m) && m !== author.id) : [], attach)
    if (fresh) {
      this.ctx.delivery.send(await this.store.members(room), { e: 'chat.message', p: message })
      this.ctx.bus.emit('chat.posted', message)
    }
    return message
  }
  /** A room opened (of a shared space — when given; a comment — its place): every member online gets it at once. */
  async open(title: string, createdBy: string, members: readonly string[], space?: string, comment?: { doc: string; anchor: CommentAnchor }): Promise<string> {
    const id = await this.store.createRoom(title, createdBy, members, space, comment)
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
  /** «Печатает…» to the room's other members. */
  async typing(room: string, who: DeviceInfo): Promise<void> {
    this.ctx.delivery.send((await this.store.members(room)).filter((m) => m !== who.id), { e: 'chat.typing', p: { room, device: who } })
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
        const room = await memberRoom(p, s)
        const attach = p.attach === undefined ? undefined : isAttach(p.attach) ? p.attach : null
        if (attach === null) throw new RpcFail('bad', 'Вложение не подходит (или больше 180 КБ)')
        if (attach && !(await files.attachFits(room, attach))) throw new RpcFail('bad', 'Файл не найден в этом чате — отправьте его заново')
        // a block's result may go with no words
        const body = attach && typeof p.text === 'string' && !p.text.trim() ? '' : cleanChatText(p.text)
        if (body === null) throw new RpcFail('bad', 'Пустое или слишком длинное сообщение')
        const clientId = text(p, 'clientId')
        if (!clientId || clientId.length > CLIENT_ID_MAX) throw new RpcFail('bad', 'clientId: от 1 до 64 символов')
        const mentions = Array.isArray(p.mentions) ? p.mentions.filter((m): m is string => typeof m === 'string').slice(0, 50) : []
        return chat.post(room, s.device, body, clientId, mentions, attach)
      },
      'chat.create': async (p, s) => {
        const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, TITLE_MAX) : CHAT_TITLE
        const id = await chat.open(title, s.device.id, [s.device.id])
        return (await chat.store.room(id, s.device.id))!
      },
      'chat.rename': async (p, s) => {
        const room = await memberRoom(p, s)
        if ((await people.makerOf(room)) !== s.device.id) throw new RpcFail('denied', 'Переименовать чат может только тот, кто его создал')
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
      'chat.react': async (p, s) => {
        const room = await memberRoom(p, s)
        if (!isReaction(p.emoji)) throw new RpcFail('bad', 'Такой реакции нет')
        const m = await chat.store.react(room, int(p, 'seq'), s.device.id, p.emoji, p.on === true)
        if (!m) throw new RpcFail('missing', 'Сообщение не найдено')
        ctx.delivery.send(await chat.store.members(room), { e: 'chat.edited', p: m })
        return m
      },
      'chat.fileTicket': async (p, s) => ({ ticket: ticketOf(await memberRoom(p, s), s.device.id) }),
      'chat.read': async (p, s) => {
        await chat.store.read(await memberRoom(p, s), s.device.id, int(p, 'seq'))
        return null
      },
    },
  }
}
