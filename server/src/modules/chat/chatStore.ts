import { randomUUID } from 'node:crypto'
import { REPLY_TEXT_MAX, type ChatAgent, type ChatAttach, type ChatMessage, type ChatReply, type ChatRoom, type CommentAnchor } from '../../../../src/shared/transport/chat'
import type { DeviceInfo } from '../../../../src/shared/transport/protocol'
import type { Db, Sql } from '../../db'
import type { RoomPlace } from '../../ports'

/** The chat's tables: rooms (their message counter), members (what each has read), messages (numbered in a room). */
export const CHAT_MIGRATIONS = [
  `create table chat_rooms (
     id uuid primary key,
     title text not null,
     created_by text not null references qa_devices (id),
     created_at timestamptz not null default now(),
     last_seq bigint not null default 0
   );
   create table chat_members (
     room uuid not null references chat_rooms (id) on delete cascade,
     device text not null references qa_devices (id),
     joined_at timestamptz not null default now(),
     read_seq bigint not null default 0,
     primary key (room, device)
   );
   create index chat_members_device on chat_members (device);
   create table chat_messages (
     room uuid not null references chat_rooms (id) on delete cascade,
     seq bigint not null,
     id uuid not null unique,
     author text not null references qa_devices (id),
     text text not null,
     client_id text,
     at timestamptz not null default now(),
     primary key (room, seq)
   );
   create unique index chat_messages_client on chat_messages (author, client_id) where client_id is not null;`,
]

/** Reactions and mentions of the messages (a step of its own: the chats made before them stay). */
export const CHAT_REACTIONS_MIGRATION = `create table chat_reactions (
     room uuid not null,
     seq bigint not null,
     device text not null references qa_devices (id),
     emoji text not null,
     at timestamptz not null default now(),
     primary key (room, seq, device, emoji),
     foreign key (room, seq) references chat_messages (room, seq) on delete cascade
   );
   alter table chat_messages add column mentions text[];`
/** Branches of a conversation and the blocks' results in messages. */
export const CHAT_BRANCHES_MIGRATION = `alter table chat_rooms add column parent uuid references chat_rooms (id) on delete set null;
   alter table chat_messages add column attach jsonb;`
/** A message answering another: the answered one kept with it. */
export const CHAT_REPLY_MIGRATION = 'alter table chat_messages add column reply jsonb;'
/**
 * Where a room belongs — a shared space, a comment's document, place and state — as the chat's own columns: the space
 * module once added them with keys to its tables (a database of then has them: only those keys go — a deleted space
 * takes its rooms away by the chat's port now).
 */
export const CHAT_PLACE_MIGRATION = `alter table chat_rooms add column if not exists space uuid, add column if not exists doc uuid,
     add column if not exists anchor jsonb, add column if not exists resolved boolean not null default false;
   do $$ declare c record; begin
     for c in select conname from pg_constraint where conrelid = 'chat_rooms'::regclass and contype = 'f'
         and confrelid in (to_regclass('spaces'), to_regclass('space_docs')) loop
       execute format('alter table chat_rooms drop constraint %I', c.conname);
     end loop;
   end $$;
   create index if not exists chat_rooms_space on chat_rooms (space);
   create index if not exists chat_rooms_doc on chat_rooms (doc) where doc is not null;`
/** A resend is recognised within its room (two rooms may hold the same `clientId` of one author). */
export const CHAT_CLIENT_ID_MIGRATION = `drop index chat_messages_client;
   create unique index chat_messages_client on chat_messages (room, author, client_id) where client_id is not null;`

/** A message written by a member's agent: which, and how deep in a chain of agents; `at` — when (a chat's history brought from the app). */
export interface AgentStamp {
  agent?: { id: string; name: string }
  chain?: number
  at?: number
  /** The number of the message it answers (kept as that message is now: its author, a piece of its text). */
  reply?: number
}
/** A message to keep: its author (a device), text, the sender's own id, mentions, attachment, agent's stamp. */
export interface NewMessage {
  author: string
  text: string
  clientId?: string
  mentions?: readonly string[]
  attach?: ChatAttach
  by?: AgentStamp
}

/** A message's columns with its author (the name as it is now), its mentions, its reactions (emoji → who). */
const MESSAGE_COLS = `m.room, m.seq, m.id, m.text, m.client_id, m.mentions, m.attach, m.agent, m.chain, m.reply, (extract(epoch from m.at) * 1000)::bigint as at, d.id as author_id, d.name as author_name,
    (select json_object_agg(g.emoji, g.people) from (select x.emoji, json_agg(json_build_object('id', p.id, 'name', p.name) order by x.at) as people
       from chat_reactions x join qa_devices p on p.id = x.device where x.room = m.room and x.seq = m.seq group by x.emoji) g) as reactions`
interface MessageRow {
  room: string
  seq: number
  id: string
  text: string
  client_id: string | null
  mentions: string[] | null
  attach: ChatAttach | null
  agent: { id: string; name: string } | null
  chain: number | null
  reply: ChatReply | null
  at: number
  author_id: string
  author_name: string
  reactions: Record<string, DeviceInfo[]> | null
}
const device = (id: string, name: string): DeviceInfo => ({ id, name })
const messageOf = (r: MessageRow): ChatMessage => ({
  room: r.room,
  seq: r.seq,
  id: r.id,
  author: device(r.author_id, r.author_name),
  text: r.text,
  at: Number(r.at),
  ...(r.client_id ? { clientId: r.client_id } : {}),
  ...(r.mentions?.length ? { mentions: r.mentions } : {}),
  ...(r.reactions ? { reactions: r.reactions } : {}),
  ...(r.attach ? { attach: r.attach } : {}),
  ...(r.agent ? { agent: r.agent } : {}),
  ...(r.chain ? { chain: r.chain } : {}),
  ...(r.reply ? { reply: r.reply } : {}),
})

interface RoomRow {
  id: string
  title: string
  space: string | null
  doc: string | null
  anchor: CommentAnchor | null
  resolved: boolean | null
  created_by: string
  parent: string | null
  last_seq: number
  read_seq: number
  members: Array<{ id: string; name: string }>
  agents: ChatAgent[] | null
  last: MessageRow | null
}
const ROOM_SELECT = `select r.id, r.title, r.space, r.doc, r.anchor, r.resolved, r.created_by, r.parent, r.last_seq, me.read_seq,
    (select json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name)
       from chat_members x join qa_devices d on d.id = x.device where x.room = r.id) as members,
    (select json_agg(json_build_object('id', a.id, 'name', a.name, 'owner', a.owner, 'open', a.open) order by a.added_at)
       from chat_agents a where a.room = r.id and exists (select 1 from chat_members o where o.room = r.id and o.device = a.owner)) as agents,
    (select row_to_json(l) from (select ${MESSAGE_COLS} from chat_messages m join qa_devices d on d.id = m.author
       where m.room = r.id order by m.seq desc limit 1) l) as last
  from chat_rooms r join chat_members me on me.room = r.id and me.device = $1`
const roomOf = (r: RoomRow): ChatRoom => ({
  id: r.id,
  title: r.title,
  members: (r.members ?? []).map((m) => device(m.id, m.name)),
  lastSeq: r.last_seq,
  readSeq: r.read_seq,
  ...(r.last ? { last: messageOf(r.last) } : {}),
  ...(r.space ? { space: r.space } : {}),
  ...(r.doc && r.anchor ? { doc: r.doc, anchor: r.anchor, resolved: !!r.resolved } : {}),
  createdBy: r.created_by,
  ...(r.parent ? { parent: r.parent } : {}),
  ...(r.agents?.length ? { agents: r.agents.map(({ open, ...a }) => (open ? { ...a, open } : a)) } : {}),
})

/** The chat in the database (who may see what is the caller's check — `isMember`). */
export class ChatStore {
  constructor(private readonly db: Db) {}

  async isMember(room: string, device: string): Promise<boolean> {
    return !!(await this.db.one('select 1 from chat_members where room = $1 and device = $2', [room, device]))
  }
  async members(room: string): Promise<string[]> {
    return (await this.db.rows<{ device: string }>('select device from chat_members where room = $1', [room])).map((r) => r.device)
  }
  /** The rooms of a device. */
  async roomsOf(dev: string): Promise<ChatRoom[]> {
    return (await this.db.rows<RoomRow>(ROOM_SELECT, [dev])).map(roomOf)
  }
  /** Where a room belongs: a shared space (a comment — its document too); none — a chat of its own people. */
  async placeOf(room: string): Promise<{ space?: string; doc?: string }> {
    const r = await this.db.one<{ space: string | null; doc: string | null }>('select space, doc from chat_rooms where id = $1', [room])
    return { ...(r?.space ? { space: r.space } : {}), ...(r?.doc ? { doc: r.doc } : {}) }
  }
  /** One room as a member sees it. */
  async room(room: string, dev: string): Promise<ChatRoom | undefined> {
    const r = await this.db.one<RoomRow>(`${ROOM_SELECT} where r.id = $2`, [dev, room])
    return r && roomOf(r)
  }
  /** Messages before `before` (none — the latest), at most `limit`, oldest first. */
  async history(room: string, before: number | undefined, limit: number): Promise<ChatMessage[]> {
    const rows = await this.db.rows<MessageRow>(
      `select ${MESSAGE_COLS} from chat_messages m join qa_devices d on d.id = m.author
       where m.room = $1 and ($2::bigint is null or m.seq < $2) order by m.seq desc limit $3`,
      [room, before ?? null, limit],
    )
    return rows.reverse().map(messageOf)
  }
  /** A room made with its members (of a shared space — when given; a comment — its document and place). */
  async createRoom(sql: Sql, title: string, createdBy: string, members: readonly string[], { space, comment, id = randomUUID() }: RoomPlace = {}): Promise<string> {
    await sql.rows('insert into chat_rooms (id, title, created_by, space, doc, anchor) values ($1, $2, $3, $4, $5, $6)', [id, title, createdBy, space ?? null, comment?.doc ?? null, comment ? JSON.stringify(comment.anchor) : null])
    await sql.rows('insert into chat_members (room, device) select $1, unnest($2::text[]) on conflict do nothing', [id, [...new Set(members)]])
    return id
  }
  /** The comment of a document whose first message this is (the author's `clientId` — a resend), none — undefined. */
  async commentOf(doc: string, author: string, clientId: string): Promise<string | undefined> {
    const r = await this.db.one<{ room: string }>('select m.room from chat_messages m join chat_rooms r on r.id = m.room where r.doc = $1 and m.author = $2 and m.client_id = $3 and m.seq = 1', [doc, author, clientId])
    return r?.room
  }
  /**
   * A message added as the room's next number; read by its author up to it. The same `clientId` of the same author in
   * the room again (a resend after a lost answer) — the message already kept, `fresh: false`.
   */
  async post(room: string, msg: NewMessage): Promise<{ message: ChatMessage; fresh: boolean }> {
    try {
      return await this.db.tx((sql) => this.postIn(sql, room, msg))
    } catch (e) {
      // the same resend twice at once: the other one kept it
      const had = msg.clientId && (e as { code?: string }).code === '23505' ? await this.byClientId(this.db, room, msg.author, msg.clientId) : undefined
      if (had) return { message: had, fresh: false }
      throw e
    }
  }
  /** `post` in the caller's transaction (a resend at the same moment fails it). */
  async postIn(sql: Sql, room: string, { author, text, clientId, mentions = [], attach, by = {} }: NewMessage): Promise<{ message: ChatMessage; fresh: boolean }> {
    const had = clientId ? await this.byClientId(sql, room, author, clientId) : undefined
    if (had) return { message: had, fresh: false }
    // the room's row locked: messages of one room are numbered one after another
    const r = await sql.one<{ last_seq: number }>('update chat_rooms set last_seq = last_seq + 1 where id = $1 returning last_seq', [room])
    if (!r) throw new Error('комната не найдена')
    // (an answer keeps the answered message as it is now: its author, a piece of its text)
    await sql.rows(
      `insert into chat_messages (room, seq, id, author, text, client_id, mentions, attach, agent, chain, at, reply) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce(to_timestamp($11::float8 / 1000), now()),
      (select json_build_object('seq', x.seq, 'author', coalesce(x.agent->>'name', dx.name), 'text', left(coalesce(nullif(btrim(x.text), ''), x.attach->>'title', ''), ${REPLY_TEXT_MAX}))
         from chat_messages x join qa_devices dx on dx.id = x.author where x.room = $1 and x.seq = $12))`,
      [
        room,
        r.last_seq,
        randomUUID(),
        author,
        text,
        clientId ?? null,
        mentions.length ? mentions : null,
        attach ? JSON.stringify(attach) : null,
        by.agent ? JSON.stringify(by.agent) : null,
        by.chain ?? null,
        by.at ?? null,
        by.reply ?? null,
      ],
    )
    await sql.rows('update chat_members set read_seq = greatest(read_seq, $3) where room = $1 and device = $2', [room, author, r.last_seq])
    const m = await sql.one<MessageRow>(`select ${MESSAGE_COLS} from chat_messages m join qa_devices d on d.id = m.author where m.room = $1 and m.seq = $2`, [room, r.last_seq])
    return { message: messageOf(m!), fresh: true }
  }
  /** A reaction put / taken back; the message as it is now (none — no such message). */
  async react(room: string, seq: number, dev: string, emoji: string, on: boolean): Promise<ChatMessage | undefined> {
    if (on) await this.db.rows('insert into chat_reactions (room, seq, device, emoji) select $1, $2, $3, $4 where exists (select 1 from chat_messages where room = $1 and seq = $2) on conflict do nothing', [room, seq, dev, emoji])
    else await this.db.rows('delete from chat_reactions where room = $1 and seq = $2 and device = $3 and emoji = $4', [room, seq, dev, emoji])
    const r = await this.db.one<MessageRow>(`select ${MESSAGE_COLS} from chat_messages m join qa_devices d on d.id = m.author where m.room = $1 and m.seq = $2`, [room, seq])
    return r && messageOf(r)
  }
  /** Read up to `seq` (never back, never past the room's last message). */
  async read(room: string, dev: string, seq: number): Promise<void> {
    await this.db.rows(
      `update chat_members me set read_seq = greatest(me.read_seq, least($3, r.last_seq))
       from chat_rooms r where r.id = me.room and me.room = $1 and me.device = $2`,
      [room, dev, seq],
    )
  }
  /** A comment solved / opened again (not a comment — nothing). */
  async resolve(room: string, resolved: boolean): Promise<void> {
    await this.db.rows('update chat_rooms set resolved = $2 where id = $1 and doc is not null', [room, resolved])
  }
  /** A device put into every room of a space; the rooms it got. */
  async joinSpace(sql: Sql, space: string, dev: string): Promise<string[]> {
    const rows = await sql.rows<{ room: string }>('insert into chat_members (room, device) select id, $2 from chat_rooms where space = $1 on conflict do nothing returning room', [space, dev])
    return rows.map((r) => r.room)
  }
  async leaveSpace(sql: Sql, space: string, dev: string): Promise<void> {
    await sql.rows('delete from chat_members where device = $2 and room in (select id from chat_rooms where space = $1)', [space, dev])
  }
  async dropSpace(sql: Sql, space: string): Promise<void> {
    await sql.rows('delete from chat_rooms where space = $1', [space])
  }
  async dropDocs(sql: Sql, docs: readonly string[]): Promise<void> {
    if (docs.length) await sql.rows('delete from chat_rooms where doc = any($1::uuid[])', [docs])
  }

  private async byClientId(sql: Sql, room: string, author: string, clientId: string): Promise<ChatMessage | undefined> {
    const r = await sql.one<MessageRow>(`select ${MESSAGE_COLS} from chat_messages m join qa_devices d on d.id = m.author where m.room = $1 and m.author = $2 and m.client_id = $3`, [room, author, clientId])
    return r && messageOf(r)
  }
}
