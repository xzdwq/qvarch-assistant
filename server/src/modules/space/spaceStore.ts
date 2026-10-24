import { randomInt, randomUUID } from 'node:crypto'
import { docTitleOf, freeDocPath, INVITE_ALPHABET, INVITE_LENGTH, type Space, type SpaceKind, type SpaceRole } from '../../../../src/shared/transport/space'
import type { Db, Sql } from '../../db'

/** The spaces' tables: a space, its members with roles, its invitations, its documents. */
export const SPACE_MIGRATIONS = [
  `create table spaces (
     id uuid primary key,
     title text not null,
     owner text not null references qa_devices (id),
     created_at timestamptz not null default now()
   );
   create table space_members (
     space uuid not null references spaces (id) on delete cascade,
     device text not null references qa_devices (id),
     role text not null check (role in ('owner', 'editor', 'commenter', 'reader')),
     joined_at timestamptz not null default now(),
     primary key (space, device)
   );
   create index space_members_device on space_members (device);
   create table space_invites (
     code text primary key,
     space uuid not null references spaces (id) on delete cascade,
     role text not null,
     created_by text not null references qa_devices (id),
     expires_at timestamptz not null
   );
   create table space_docs (
     id uuid primary key,
     space uuid not null references spaces (id) on delete cascade,
     title text not null,
     created_at timestamptz not null default now()
   );`,
]

/** Shared folders: a space's kind; a document's path in it, its deletion (kept a while). */
export const SPACE_FOLDER_MIGRATION = `alter table spaces add column kind text not null default 'doc' check (kind in ('doc', 'folder'));
   alter table space_docs add column path text;
   update space_docs set path = title || '.md';
   alter table space_docs alter column path set not null;
   alter table space_docs add column deleted_at timestamptz;
   create unique index space_docs_path on space_docs (space, path) where deleted_at is null;`

/** An invitation lives this long. */
const INVITE_DAYS = 7

interface SpaceRow {
  id: string
  title: string
  kind: SpaceKind
  role: SpaceRole
  members: Array<{ id: string; name: string; bot: boolean; role: SpaceRole }>
  docs: Array<{ id: string; title: string; path: string; deleted: boolean }> | null
}
const SPACE_SELECT = `select s.id, s.title, s.kind, me.role,
    (select json_agg(json_build_object('id', d.id, 'name', d.name, 'bot', d.bot, 'role', m.role) order by m.joined_at)
       from space_members m join qa_devices d on d.id = m.device where m.space = s.id) as members,
    (select json_agg(json_build_object('id', x.id, 'title', x.title, 'path', x.path, 'deleted', x.deleted_at is not null) order by x.path)
       from space_docs x where x.space = s.id) as docs
  from spaces s join space_members me on me.space = s.id and me.device = $1`
const spaceOf = (r: SpaceRow): Space => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  role: r.role,
  members: r.members.map((m) => ({ id: m.id, name: m.name, role: m.role, ...(m.bot ? { bot: true } : {}) })),
  docs: (r.docs ?? []).map((d) => ({ id: d.id, title: d.title, path: d.path, ...(d.deleted ? { deleted: true } : {}) })),
})
const titleOf = docTitleOf

const newCode = () => Array.from({ length: INVITE_LENGTH }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('')

/** The spaces in the database (who may do what is the caller's check — `roleOf`). */
export class SpaceStore {
  constructor(private readonly db: Db) {}

  async roleOf(space: string, device: string): Promise<SpaceRole | undefined> {
    return (await this.db.one<{ role: SpaceRole }>('select role from space_members where space = $1 and device = $2', [space, device]))?.role
  }
  /** The role of a device in the space of a document, deleted ones too (none — not a member, or no such document). */
  async docRole(doc: string, device: string): Promise<{ space: string; role: SpaceRole } | undefined> {
    return this.db.one('select x.space, m.role from space_docs x join space_members m on m.space = x.space and m.device = $2 where x.id = $1', [doc, device])
  }
  async members(space: string): Promise<string[]> {
    return (await this.db.rows<{ device: string }>('select device from space_members where space = $1', [space])).map((r) => r.device)
  }
  async spacesOf(device: string): Promise<Space[]> {
    return (await this.db.rows<SpaceRow>(SPACE_SELECT, [device])).map(spaceOf)
  }
  async space(space: string, device: string): Promise<Space | undefined> {
    const r = await this.db.one<SpaceRow>(`${SPACE_SELECT} where s.id = $2`, [device, space])
    return r && spaceOf(r)
  }
  /** A space made with its owner (a note's — with its document: its initial state comes with it). */
  async create(title: string, owner: string, kind: SpaceKind, init?: (sql: Sql, doc: string) => Promise<void>): Promise<{ space: string; doc?: string }> {
    const space = randomUUID()
    const doc = init ? randomUUID() : undefined
    await this.db.tx(async (sql) => {
      await sql.rows('insert into spaces (id, title, owner, kind) values ($1, $2, $3, $4)', [space, title, owner, kind])
      await sql.rows(`insert into space_members (space, device, role) values ($1, $2, 'owner')`, [space, owner])
      if (doc && init) {
        await sql.rows('insert into space_docs (id, space, title, path) values ($1, $2, $3, $4)', [doc, space, title, `${title}.md`])
        await init(sql, doc)
      }
    })
    return { space, doc }
  }
  /** The space of a document (deleted ones too). */
  async docSpace(doc: string): Promise<string | undefined> {
    return (await this.db.one<{ space: string }>('select space from space_docs where id = $1', [doc]))?.space
  }
  /** A path free in the space (the document itself — not in the way). */
  private async freePath(sql: Sql, space: string, path: string, self?: string): Promise<string> {
    const rows = await sql.rows<{ path: string }>('select path from space_docs where space = $1 and deleted_at is null and id is distinct from $2', [space, self ?? null])
    const taken = new Set(rows.map((r) => r.path.toLowerCase()))
    return freeDocPath(path, (p) => taken.has(p.toLowerCase()))
  }
  /** A document added at a free path; its first state comes with it. */
  async addDoc(space: string, path: string, init: (sql: Sql, doc: string) => Promise<void>): Promise<{ doc: string; path: string }> {
    const doc = randomUUID()
    return this.db.tx(async (sql) => {
      await sql.rows('select pg_advisory_xact_lock(hashtext($1))', [space])
      const free = await this.freePath(sql, space, path)
      await sql.rows('insert into space_docs (id, space, title, path) values ($1, $2, $3, $4)', [doc, space, titleOf(free), free])
      await init(sql, doc)
      return { doc, path: free }
    })
  }
  /** A document moved / renamed to a free path; a deleted one — brought back (to a free path). */
  async placeDoc(doc: string, path: string | undefined): Promise<string> {
    return this.db.tx(async (sql) => {
      const cur = await sql.one<{ space: string; path: string }>('select space, path from space_docs where id = $1', [doc])
      if (!cur) throw new Error('документ не найден')
      await sql.rows('select pg_advisory_xact_lock(hashtext($1))', [cur.space])
      const free = await this.freePath(sql, cur.space, path ?? cur.path, doc)
      await sql.rows('update space_docs set path = $2, title = $3, deleted_at = null where id = $1', [doc, free, titleOf(free)])
      return free
    })
  }
  async deleteDoc(doc: string): Promise<void> {
    await this.db.rows('update space_docs set deleted_at = now() where id = $1 and deleted_at is null', [doc])
  }
  async invite(space: string, role: SpaceRole, by: string): Promise<string> {
    for (;;) {
      const code = newCode()
      const r = await this.db.one(
        `insert into space_invites (code, space, role, created_by, expires_at) values ($1, $2, $3, $4, now() + make_interval(days => $5))
         on conflict (code) do nothing returning code`,
        [code, space, role, by, INVITE_DAYS],
      )
      if (r) return code
    }
  }
  /** An invitation used: the device joins with its role (a member already keeps the higher of the two). */
  async join(code: string, device: string): Promise<string | undefined> {
    const inv = await this.db.one<{ space: string; role: SpaceRole }>('select space, role from space_invites where code = $1 and expires_at > now()', [code])
    if (!inv) return undefined
    await this.db.rows(
      `insert into space_members (space, device, role) values ($1, $2, $3)
       on conflict (space, device) do update set role = case
         when array_position(array['owner','editor','commenter','reader'], space_members.role) <= array_position(array['owner','editor','commenter','reader'], excluded.role)
         then space_members.role else excluded.role end`,
      [inv.space, device, inv.role],
    )
    return inv.space
  }
  async setRole(space: string, device: string, role: SpaceRole): Promise<boolean> {
    return (await this.db.rows(`update space_members set role = $3 where space = $1 and device = $2 and role <> 'owner' returning device`, [space, device, role])).length > 0
  }
  /** A member gone (the owner stays: the space is deleted instead). */
  async remove(space: string, device: string): Promise<boolean> {
    return (await this.db.rows(`delete from space_members where space = $1 and device = $2 and role <> 'owner' returning device`, [space, device])).length > 0
  }
  async delete(space: string): Promise<void> {
    await this.db.rows('delete from spaces where id = $1', [space])
  }
}
