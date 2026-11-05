import { cleanDocPath, INVITE_ROLES, isSpaceRole, normalizeInvite, ROLE_RIGHTS, type SpaceKind, type SpaceRole } from '../../../../src/shared/transport/space'
import { cleanChatText, QUOTE_MAX, type CommentAnchor } from '../../../../src/shared/transport/chat'
import type { Sql } from '../../db'
import { RpcFail, text, uuid, yjsUpdate, type ModuleFactory, type ServerContext, type Session } from '../../module'
import { SPACE_FOLDER_MIGRATION, SPACE_MIGRATIONS, SPACE_SLIM_MIGRATION, SpaceStore } from './spaceStore'

const TITLE_MAX = 200

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
 * members: one who joins gets them, one who goes — loses them (in the same transaction; told after it).
 */
export const spaceModule: ModuleFactory = (ctx: ServerContext) => {
  const store = new SpaceStore(ctx.db)
  const rooms = () => ctx.ports.get('chatRooms')
  const docInit = (update: Uint8Array, author: string) => (sql: Sql, doc: string) => ctx.ports.get('docs').init(sql, doc, update, author)
  ctx.ports.provide('spaces', {
    roleOf: (space, device) => store.roleOf(space, device),
    docRole: (doc, device) => store.docRole(doc, device),
    docSpace: (doc) => store.docSpace(doc),
    members: (space) => store.members(space),
    peersOf: (device) => store.peersOf(device),
  })

  /** A member's role, or a refusal; `need` — the right the call needs. */
  async function roleIn(space: string, s: Session, need?: keyof (typeof ROLE_RIGHTS)['owner']): Promise<SpaceRole> {
    const role = await store.roleOf(space, s.device.id)
    if (!role) throw new RpcFail('denied', 'Нет доступа к этому документу')
    if (need && !ROLE_RIGHTS[role][need]) throw new RpcFail('denied', 'Недостаточно прав')
    return role
  }
  /** Every member told the space as they see it now. */
  async function changed(space: string): Promise<void> {
    for (const m of await store.members(space)) {
      const sp = await store.space(space, m)
      if (sp) ctx.delivery.send([m], { e: 'space.changed', p: sp })
    }
  }
  /** A device out of the space (after the commit): told, its open documents of it closed. */
  function gone(space: string, device: string): void {
    ctx.delivery.send([device], { e: 'space.gone', p: { space } })
    ctx.bus.emit('space.left', { space, device })
  }
  /** A member taken out of the space and its chats at once; whether it was one (the owner never is). */
  const removeMember = (space: string, device: string) =>
    ctx.db.tx(async (sql) => {
      if (!(await store.remove(sql, space, device))) return false
      await rooms().leaveSpace(sql, space, device)
      return true
    })
  /** The space of a document an editor changes (a refusal otherwise). */
  async function docSpaceIn(doc: string, s: Session): Promise<string> {
    const space = await store.docSpace(doc)
    if (!space) throw new RpcFail('missing', 'Документ не найден')
    await roleIn(space, s, 'edit')
    return space
  }
  const mustSpace = async (space: string, device: string) => (await store.space(space, device)) ?? Promise.reject(new RpcFail('missing', 'Документ не найден'))
  /** A room as the caller sees it (just made or changed by it). */
  const roomFor = async (room: string, s: Session) => (await rooms().view(room, s.device.id))!

  return {
    name: 'space',
    migrations: [
      ...SPACE_MIGRATIONS,
      // (was: the chat rooms' space column — the chat module keeps its rooms' place now; a database of then has it)
      'select 1;',
      SPACE_FOLDER_MIGRATION,
      // (was: the chat rooms' comment columns — the same)
      'select 1;',
      SPACE_SLIM_MIGRATION,
    ],
    methods: {
      'space.share': async (p, s) => {
        const t = title(p)
        const kind: SpaceKind = p.kind === 'folder' ? 'folder' : 'doc'
        const init = kind === 'doc' ? docInit(yjsUpdate(p, 'update'), s.device.id) : undefined
        const { space, doc } = await store.create(t, s.device.id, kind, init)
        return { space: await mustSpace(space, s.device.id), ...(doc ? { doc } : {}) }
      },
      // (a folder's note, or a board of a shared note — a note's space holds its boards too)
      'space.addDoc': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'edit')
        const path = cleanDocPath(p.path)
        if (!path) throw new RpcFail('bad', 'path: путь заметки или доски внутри папки')
        const r = await store.addDoc(space, path, docInit(yjsUpdate(p, 'update'), s.device.id))
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
      // (every connection asks: the documents deleted long ago go then — with their comments)
      'space.list': async (_p, s) => {
        await ctx.db.tx(async (sql) => rooms().dropDocs(sql, await store.purgeDeleted(sql, s.device.id)))
        return store.spacesOf(s.device.id)
      },
      'space.invite': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'manage')
        if (!isSpaceRole(p.role) || !INVITE_ROLES.includes(p.role)) throw new RpcFail('bad', 'Неизвестная роль')
        return { code: await store.invite(space, p.role) }
      },
      'space.join': async (p, s) => {
        const code = normalizeInvite(text(p, 'code'))
        const joined = await ctx.db.tx(async (sql) => {
          const space = await store.join(sql, code, s.device.id)
          return space && { space, rooms: await rooms().joinSpace(sql, space, s.device.id) }
        })
        if (!joined) throw new RpcFail('missing', 'Код не найден или истёк')
        await rooms().tell(joined.rooms, [s.device.id])
        await changed(joined.space)
        return mustSpace(joined.space, s.device.id)
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
        if (!(await removeMember(space, device))) throw new RpcFail('missing', 'Участник не найден')
        gone(space, device)
        await changed(space)
        return mustSpace(space, s.device.id)
      },
      'space.leave': async (p, s) => {
        const space = uuid(p, 'space')
        const role = await roleIn(space, s)
        if (role === 'owner') {
          const members = await ctx.db.tx(async (sql) => {
            const members = await store.members(space, sql)
            await rooms().dropSpace(sql, space)
            await store.delete(sql, space)
            return members
          })
          for (const m of members) gone(space, m)
          return null
        }
        if (await removeMember(space, s.device.id)) {
          gone(space, s.device.id)
          await changed(space)
        }
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
        const name = anchor.quote.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Комментарий'
        const room = await rooms().open({ title: name, by: s.device, members: await store.members(space), place: { space, comment: { doc, anchor } }, first: { text: body, clientId: text(p, 'clientId') } })
        return roomFor(room, s)
      },
      'space.resolve': async (p, s) => {
        const room = uuid(p, 'room')
        const { space, doc } = await rooms().placeOf(room)
        if (!space || !doc) throw new RpcFail('missing', 'Комментарий не найден')
        await roleIn(space, s, 'chat')
        await rooms().resolve(room, p.resolved === true)
        return roomFor(room, s)
      },
      'space.chat': async (p, s) => {
        const space = uuid(p, 'space')
        await roleIn(space, s, 'chat')
        const id = await rooms().open({ title: title(p), by: s.device, members: await store.members(space), place: { space } })
        return roomFor(id, s)
      },
    },
  }
}
