import { CLIENT_ID_MAX, type ChatAttach, type ChatMessage } from '../../../../src/shared/transport/chat'
import type { DeviceInfo } from '../../../../src/shared/transport/protocol'
import type { ServerContext } from '../../module'
import type { ChatRoomsPort } from '../../ports'
import { ChatAgents } from './chatAgents'
import { ChatStore, type AgentStamp } from './chatStore'

/**
 * The chat as its methods and the other modules use it: a message posted reaches the members online; a room opened,
 * changed or joined — its members. What changes the database is told only once it is kept.
 */
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
  async post(room: string, author: DeviceInfo, text: string, clientId?: string, mentions: readonly string[] = [], attach?: ChatAttach, by: AgentStamp = {}): Promise<ChatMessage> {
    const known = mentions.length ? new Set([...(await this.store.members(room)), ...(await this.agents.ids(room))]) : undefined
    const self = by.agent?.id ?? author.id
    const kept = known ? [...new Set(mentions)].filter((m) => known.has(m) && m !== self) : []
    const { message, fresh } = await this.store.post(room, { author: author.id, text, clientId, mentions: kept, attach, by })
    if (fresh) this.ctx.delivery.send(await this.store.members(room), { e: 'chat.message', p: message })
    return message
  }
  /** Rooms told as they are now: to these devices (none given — to every member of each). */
  async tell(rooms: readonly string[], to?: readonly string[]): Promise<void> {
    for (const room of rooms)
      for (const m of to ?? (await this.store.members(room))) {
        const r = await this.store.room(room, m)
        if (r) this.ctx.delivery.send([m], { e: 'chat.room', p: r })
      }
  }
  /** Every member online gets the room as it is now (opened, solved…). */
  told(room: string): Promise<void> {
    return this.tell([room])
  }

  /** The port the other modules use (see `ChatRoomsPort`). */
  readonly port: ChatRoomsPort = {
    open: async ({ title, by, members, place, first }) => {
      const clientId = first?.clientId?.slice(0, CLIENT_ID_MAX) || undefined
      const had = clientId && place.comment ? await this.store.commentOf(place.comment.doc, by.id, clientId) : undefined
      if (had) return had
      const { id, message } = await this.ctx.db.tx(async (sql) => {
        const id = await this.store.createRoom(sql, title, by.id, members, place)
        const posted = first && (await this.store.postIn(sql, id, { author: by.id, text: first.text, clientId }))
        return { id, message: posted?.message }
      })
      await this.told(id)
      if (message) this.ctx.delivery.send(await this.store.members(id), { e: 'chat.message', p: message })
      return id
    },
    view: (room, device) => this.store.room(room, device),
    placeOf: (room) => this.store.placeOf(room),
    resolve: async (room, resolved) => {
      await this.store.resolve(room, resolved)
      await this.told(room)
    },
    joinSpace: (sql, space, device) => this.store.joinSpace(sql, space, device),
    leaveSpace: (sql, space, device) => this.store.leaveSpace(sql, space, device),
    dropSpace: (sql, space) => this.store.dropSpace(sql, space),
    dropDocs: (sql, docs) => this.store.dropDocs(sql, docs),
    tell: (rooms, to) => this.tell(rooms, to),
  }
}
