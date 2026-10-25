import * as Y from 'yjs'
import { cleanDocPath, INVITE_ROLES, isSpaceRole, normalizeInvite, ROLE_RIGHTS, type Space, type SpaceKind, type SpaceRole } from '../../../../src/shared/transport/space'
import { cleanChatText, QUOTE_MAX, type CommentAnchor } from '../../../../src/shared/transport/chat'
import type { Sql } from '../../db'
import { RpcFail, text, uuid, type ModuleFactory, type ServerContext, type Session } from '../../module'
import { Chat } from '../chat'
import { DocStore } from '../doc/docStore'
import { SPACE_FOLDER_MIGRATION, SPACE_MIGRATIONS, SpaceStore } from './spaceStore'

const TITLE_MAX = 200

/** A Yjs update from the wire (base64) — one that does not apply is refused. */
export function readUpdate(b64: unknown): Uint8Array {
  if (typeof b64 !== 'string' || !b64) throw new RpcFail('bad', 'update: нужны данные документа')
  const u = Buffer.from(b64, 'base64')
  try {
    Y.applyUpdate(new Y.Doc(), u)
  } catch {
    throw new RpcFail('bad', 'update: это не данные документа')
  }
  return u
}
/** A comment's place as sent (its positions — short base64, its quote — trimmed); a wrong one is refused. */
function readAnchor(a: unknown): CommentAnchor {
  const o = (a && typeof a === 'object' ? a : {}) as Partial<CommentAnchor>
  const pos = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9+/=]{1,200}$/.test(v)
  if (!pos(o.start) || !pos(o.end) || typeof o.quote !== 'string') throw new RpcFail('bad', 'anchor: место комментария')
  return { start: o.start!, end: o.end!, quote: o.quote.slice(0, QUOTE_MAX) }
}
function title(p: Record<string, unknown>): string {
  const t = text(p, 'title').trim().slice(0, TITLE_MAX)
  if (!t) throw new RpcFail('bad', 'Нужно название')
  return t
}

/**
 * Shared spaces: a note shared becomes a space with its document; the owner invites by a code (with a role), changes
 * roles, removes members; a member leaves (the owner's leaving deletes the space). The space's chats have its
 * members: one who joins gets them, one who goes — loses them.
 */
export const spaceModule: ModuleFactory = (ctx: ServerContext) => {
  const store = new SpaceStore(ctx.db)
  const docs = new DocStore(ctx.db)
  const chat = new Chat(ctx)
  // its chats and comments: written by the roles that may
  ctx.spaceRules.mayChat = async (space, device) => {
    const role = await store.roleOf(space, device)
    return !!role && ROLE_RIGHTS[role].chat
  }

  /** A member's role, or a refusal; `need` — the right the call needs. */
  async function roleIn(space: string, s: Session, need?: keyof (typeof ROLE_RIGHTS)['owner']): Promise<SpaceRole> {
    const role = await store.roleOf(space, s.device.id)
    if (!role) throw new RpcFail('denied', 'Нет доступа к этому документу')
    if (need && !ROLE_RIGHTS[role][need]) throw new RpcFail('denied', 'Недостаточно прав')
    return role
  }
  /** Every member told the space as they see it now. */
  async function changed(space: string): Promise<Space | undefined> {
    let mine: Space | undefined
    for (const m of await store.members(space)) {
      const sp = await store.space(space, m)
      if (sp) ctx.delivery.send([m], { e: 'space.changed', p: sp })
      mine ??= sp
    }
    return mine
  }
  /** The space's chats: a device added to all of them (each sent to it) / taken out of them. */
  async function joinChats(space: string, device: string): Promise<void> {
    const rooms = await ctx.db.rows<{ id: string }>('insert into chat_members (room, device) select id, $2 from chat_rooms where space = $1 on conflict do nothing returning room as id', [space, device])
    for (const r of rooms) {
      const room = await chat.store.room(r.id, device)
      if (room) ctx.delivery.send([device], { e: 'chat.room', p: room })
    }
  }
  async function leaveChats(space: string, device: string): Promise<void> {
    await ctx.db.rows('delete from chat_members where device = $2 and room in (select id from chat_rooms where space = $1)', [space, device])
  }
  /** A device out of the space: told, its chats and open documents of it closed. */
  async function gone(space: string, device: string): Promise<void> {
    ctx.delivery.send([device], { e: 'space.gone', p: { space } })
    ctx.bus.emit('space.left', { space, device })
  }
  /** The space of a document an editor changes (a refusal otherwise). */
  async function docSpaceIn(doc: string, s: Session): Promise<string> {
    const space = await store.docSpace(doc)
    if (!space) throw new RpcFail('missing', 'Документ не найден')
    await roleIn(space, s, 'edit')
    return space
  }
  const mustSpace = async (space: string, device: string) => (await store.space(space, device)) ?? Promise.reject(new RpcFail('missing', 'Документ не найден'))

  return {
    name: 'space',
    migrations: [
      ...SPACE_MIGRATIONS,
      'alter table chat_rooms add column space uuid references spaces (id) on delete cascade; create index chat_rooms_space on chat_rooms (space);',
      SPACE_FOLDER_MIGRATION,
      // comments: a chat of the space about a place of one of its documents
      'alter table chat_rooms add column doc uuid references space_docs (id) on delete cascade, add column anchor jsonb, add column resolved boolean not null default false;',
    ],
    methods: {
      'space.share': async (p, s) => {
        const t = title(p)
        const kind: SpaceKind = p.kind === 'folder' ? 'folder' : 'doc'
        const update = kind === 'doc' ? readUpdate(p.update) : undefined
        const init = update && ((sql: Sql, id: string) => docs.append(id, update, s.device.id, sql).then(() => undefined))
        const { space, doc } = await store.create(t, s.device.id, kind, init)
        return { space: await mustSpace(space, s.device.id), ...(doc ? { doc } : {}) }
      },
      'space.addDoc': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'edit')
        const path = cleanDocPath(p.path)
        if (!path) throw new RpcFail('bad', 'path: путь заметки или доски внутри папки')
        const update = readUpdate(p.update)
        const r = await store.addDoc(space, path, (sql, id) => docs.append(id, update, s.device.id, sql).then(() => undefined))
        await changed(space)
        return r
      },
      'space.moveDoc': async (p, s) => {
        const doc = uuid(p, 'doc')
        const space = await docSpaceIn(doc, s)
        const path = cleanDocPath(p.path)
        if (!path) throw new RpcFail('bad', 'path: путь заметки или доски внутри папки')
        const placed = await store.placeDoc(doc, path)
        await changed(space)
        return { path: placed }
      },
      'space.deleteDoc': async (p, s) => {
        const doc = uuid(p, 'doc')
        const space = await docSpaceIn(doc, s)
        await store.deleteDoc(doc)
        await changed(space)
        return null
      },
      'space.restoreDoc': async (p, s) => {
        const doc = uuid(p, 'doc')
        const space = await docSpaceIn(doc, s)
        const path = await store.placeDoc(doc, undefined)
        await changed(space)
        return { path }
      },
      'space.list': (_p, s) => store.spacesOf(s.device.id),
      'space.invite': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'manage')
        if (!isSpaceRole(p.role) || !INVITE_ROLES.includes(p.role)) throw new RpcFail('bad', 'Неизвестная роль')
        return { code: await store.invite(space, p.role, s.device.id) }
      },
      'space.join': async (p, s) => {
        const space = await store.join(normalizeInvite(text(p, 'code')), s.device.id)
        if (!space) throw new RpcFail('missing', 'Код не найден или истёк')
        await joinChats(space, s.device.id)
        await changed(space)
        return mustSpace(space, s.device.id)
      },
      'space.setRole': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'manage')
        if (!isSpaceRole(p.role) || p.role === 'owner') throw new RpcFail('bad', 'Эту роль дать нельзя')
        if (!(await store.setRole(space, text(p, 'device'), p.role))) throw new RpcFail('missing', 'Участник не найден')
        await changed(space)
        return mustSpace(space, s.device.id)
      },
      'space.remove': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'manage')
        const device = text(p, 'device')
        if (!(await store.remove(space, device))) throw new RpcFail('missing', 'Участник не найден')
        await leaveChats(space, device)
        await gone(space, device)
        await changed(space)
        return mustSpace(space, s.device.id)
      },
      'space.leave': async (p, s) => {
        const space = uuid(p, 'space')
        const role = await roleIn(space, s)
        if (role === 'owner') {
          const members = await store.members(space)
          await store.delete(space)
          for (const m of members) await gone(space, m)
          return null
        }
        await store.remove(space, s.device.id)
        await leaveChats(space, s.device.id)
        await gone(space, s.device.id)
        await changed(space)
        return null
      },
      'space.comment': async (p, s) => {
        const doc = uuid(p, 'doc')
        const space = await store.docSpace(doc)
        if (!space) throw new RpcFail('missing', 'Документ не найден')
        await roleIn(space, s, 'chat')
        const anchor = readAnchor(p.anchor)
        const body = cleanChatText(p.text)
        if (body === null) throw new RpcFail('bad', 'Пустой или слишком длинный комментарий')
        const title = anchor.quote.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Комментарий'
        const room = await chat.open(title, s.device.id, await store.members(space), { space, comment: { doc, anchor } })
        await chat.post(room, s.device, body, text(p, 'clientId').slice(0, 64) || undefined)
        return (await chat.store.room(room, s.device.id))!
      },
      'space.resolve': async (p, s) => {
        const room = uuid(p, 'room')
        const r = await ctx.db.one<{ space: string }>('select space from chat_rooms where id = $1 and doc is not null', [room])
        if (!r) throw new RpcFail('missing', 'Комментарий не найден')
        await roleIn(r.space, s, 'chat')
        await ctx.db.rows('update chat_rooms set resolved = $2 where id = $1', [room, p.resolved === true])
        await chat.told(room)
        return (await chat.store.room(room, s.device.id))!
      },
      'space.chat': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'chat')
        const id = await chat.open(title(p), s.device.id, await store.members(space), { space })
        return (await chat.store.room(id, s.device.id))!
      },
    },
  }
}
