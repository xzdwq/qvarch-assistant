import type { CommentAnchor, ChatRoom } from '../../src/shared/transport/chat'
import type { DeviceInfo } from '../../src/shared/transport/protocol'
import type { SpaceRole } from '../../src/shared/transport/space'
import type { Sql } from './db'

/**
 * What one module asks of another: each port is answered by the module owning the tables (nobody else touches them).
 * A port's work that must go with the caller's own takes the caller's transaction (`sql`); the caller tells the
 * devices only after it commits.
 */

/** Where a new room belongs: a shared space, a comment's place; its id — the app's own (made offline), else a new one. */
export interface RoomPlace {
  space?: string
  comment?: { doc: string; anchor: CommentAnchor }
  id?: string
}

/** The chat's rooms (answered by the chat module). */
export interface ChatRoomsPort {
  /**
   * A room opened with its members and, when given, its first message — all of it or nothing; the members online told
   * after. A first message resent (the same author and `clientId` in a comment of the same document) — the room it
   * made the first time. The room's id.
   */
  open(o: { title: string; by: DeviceInfo; members: readonly string[]; place: RoomPlace; first?: { text: string; clientId?: string } }): Promise<string>
  /** A room as a member sees it (none — not a member). */
  view(room: string, device: string): Promise<ChatRoom | undefined>
  /** Where a room belongs (no such room, or a chat of its own people — empty). */
  placeOf(room: string): Promise<{ space?: string; doc?: string }>
  /** A comment solved / opened again; its members told. */
  resolve(room: string, resolved: boolean): Promise<void>
  /** A device put into every room of a space; the rooms it got (tell it after the commit). */
  joinSpace(sql: Sql, space: string, device: string): Promise<string[]>
  /** A device taken out of every room of a space. */
  leaveSpace(sql: Sql, space: string, device: string): Promise<void>
  /** The rooms of a deleted space taken away. */
  dropSpace(sql: Sql, space: string): Promise<void>
  /** The comments of deleted documents taken away. */
  dropDocs(sql: Sql, docs: readonly string[]): Promise<void>
  /** Rooms told as they are now: to these devices (none given — to every member of each). */
  tell(rooms: readonly string[], to?: readonly string[]): Promise<void>
}

/** The shared spaces' members and roles (answered by the space module). */
export interface SpacesPort {
  roleOf(space: string, device: string): Promise<SpaceRole | undefined>
  /** The role of a device in the space of a document, deleted ones too (none — not a member, or no such document). */
  docRole(doc: string, device: string): Promise<{ space: string; role: SpaceRole } | undefined>
  /** The space of a document (deleted ones too). */
  docSpace(doc: string): Promise<string | undefined>
  members(space: string): Promise<string[]>
  /** The devices that share a space with this one (itself not among them). */
  peersOf(device: string): Promise<string[]>
}

/** The shared documents' history (answered by the doc module). */
export interface DocsPort {
  /** A new document's first state kept (in the transaction that makes the document). */
  init(sql: Sql, doc: string, update: Uint8Array, author: string): Promise<void>
}

export interface Ports {
  chatRooms: ChatRoomsPort
  spaces: SpacesPort
  docs: DocsPort
}

/** The ports given by the modules as they are made; asked for when used (every module is made by then). */
export class PortRegistry {
  private readonly given: Partial<Ports> = {}
  provide<K extends keyof Ports>(name: K, impl: Ports[K]): void {
    if (this.given[name]) throw new Error(`порт ${name} уже задан`)
    this.given[name] = impl
  }
  get<K extends keyof Ports>(name: K): Ports[K] {
    const p = this.given[name]
    if (!p) throw new Error(`порт ${name} не задан: его модуль не подключён`)
    return p
  }
}
