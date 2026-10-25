import type { Db } from '../../db'

/**
 * The members' AI agents in the chats: each is its owner's (a device), runs in its owner's app, and writes there by its
 * owner's connection (the server checks the owner, never runs anything). A chat may let anyone call anyone's agent.
 */
export const CHAT_AGENTS_MIGRATION = `create table chat_agents (
     room uuid not null references chat_rooms (id) on delete cascade,
     id text not null,
     owner text not null references qa_devices (id),
     name text not null,
     added_at timestamptz not null default now(),
     primary key (room, id)
   );
   alter table chat_rooms add column agents_open boolean not null default false;
   alter table chat_messages add column agent jsonb, add column chain int;`

/** Each agent's owner decides whether the room's others may call it (the room's maker no longer does). */
export const CHAT_AGENT_OPEN_MIGRATION = 'alter table chat_agents add column open boolean not null default false;'

export const AGENT_NAME_MAX = 60

export class ChatAgents {
  constructor(private readonly db: Db) {}

  /** An agent of a room (none — not there). */
  async of(room: string, id: string): Promise<{ id: string; name: string; owner: string } | undefined> {
    return this.db.one('select id, name, owner from chat_agents where room = $1 and id = $2', [room, id])
  }
  /** The ids of a room's agents (whom a message may mention besides the people). */
  async ids(room: string): Promise<string[]> {
    return (await this.db.rows<{ id: string }>('select id from chat_agents where room = $1', [room])).map((r) => r.id)
  }
  /**
   * An agent put in (again — its name updated): its name made unique in the room — not a person's there, not another
   * agent's (« 2», « 3»…).
   */
  async add(room: string, id: string, owner: string, name: string): Promise<void> {
    const taken = await this.db.rows<{ name: string }>(
      `select d.name from chat_members m join qa_devices d on d.id = m.device where m.room = $1
       union all select a.name from chat_agents a where a.room = $1 and a.id <> $2`,
      [room, id],
    )
    const names = new Set(taken.map((t) => t.name.toLowerCase()))
    let unique = name
    for (let n = 2; names.has(unique.toLowerCase()); n++) unique = `${name.slice(0, AGENT_NAME_MAX - 4)} ${n}`
    await this.db.rows('insert into chat_agents (room, id, owner, name) values ($1, $2, $3, $4) on conflict (room, id) do update set name = excluded.name', [room, id, owner, unique])
  }
  /** An agent taken out by its owner (another's — nothing). */
  async remove(room: string, id: string, owner: string): Promise<void> {
    await this.db.rows('delete from chat_agents where room = $1 and id = $2 and owner = $3', [room, id, owner])
  }
  /** Whether the room's others may call an agent (its owner decides; off by default). */
  async setOpen(room: string, id: string, owner: string, on: boolean): Promise<boolean> {
    return !!(await this.db.one('update chat_agents set open = $4 where room = $1 and id = $2 and owner = $3 returning id', [room, id, owner, on]))
  }
}
