import type { IncomingMessage, ServerResponse } from 'node:http'
import { isUuid } from '../../../../src/shared/transport/ids'
import { MEDIA_MAX, MEDIA_PATH, MEDIA_RELS_MAX, TICKET_HEADER } from '../../../../src/shared/transport/protocol'
import { isSpaceFile, mediaMimeOf, ROLE_RIGHTS } from '../../../../src/shared/transport/space'
import { decoded, readBody, reply } from '../../httpUtil'
import { RpcFail, uuid, type ModuleFactory } from '../../module'

const MEDIA_MIGRATIONS = [
  `create table space_media (
     space uuid not null references spaces (id) on delete cascade,
     rel text not null,
     data bytea not null,
     size int not null,
     created_by text not null references qa_devices (id),
     at timestamptz not null default now(),
     primary key (space, rel)
   );`,
]

/**
 * The media files of the shared notes (pictures, recordings): too big for the socket — over HTTP, with a pass the
 * socket gives (a member's; to send one — an editor's). A file is named by its path in the notebook (`.images/…`,
 * unique already) and never changes: one sent once is kept.
 */
export const mediaModule: ModuleFactory = (ctx) => {
  const spaces = () => ctx.ports.get('spaces')

  async function http(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith(MEDIA_PATH)) return false
    const [space, ...relParts] = decoded(req.url.slice(MEDIA_PATH.length)).split('/')
    const rel = relParts.join('/')
    if (!isUuid(space) || !isSpaceFile(rel)) return reply(res, 400, 'неверный путь')
    const device = ctx.tickets.deviceOf(req.headers[TICKET_HEADER] as string | undefined, space)
    const role = device && (await spaces().roleOf(space, device))
    if (!device || !role) return reply(res, 403, 'нет доступа')
    if (req.method === 'GET') {
      const row = await ctx.db.one<{ data: Buffer }>('select data from space_media where space = $1 and rel = $2', [space, rel])
      if (!row) return reply(res, 404, 'нет файла')
      res.writeHead(200, { 'content-type': mediaMimeOf(rel) ?? 'application/octet-stream', 'content-length': row.data.length })
      res.end(row.data)
      return true
    }
    if (req.method === 'PUT') {
      if (!ROLE_RIGHTS[role].edit) return reply(res, 403, 'только чтение')
      const body = await readBody(req, MEDIA_MAX)
      if (!body) return reply(res, 413, 'файл слишком большой')
      const fresh = await ctx.db.rows('insert into space_media (space, rel, data, size, created_by) values ($1, $2, $3, $4, $5) on conflict (space, rel) do nothing returning rel', [space, rel, body, body.length, device])
      // the others told: one who opened the note before the file came fetches it now
      if (fresh.length) ctx.delivery.send((await spaces().members(space)).filter((m) => m !== device), { e: 'media.added', p: { space, rels: [rel], by: device } })
      return reply(res, 204)
    }
    return reply(res, 405)
  }

  return {
    name: 'media',
    migrations: MEDIA_MIGRATIONS,
    http,
    methods: {
      'media.ticket': async (p, s) => {
        const space = uuid(p, 'space')
        if (!(await spaces().roleOf(space, s.device.id))) throw new RpcFail('denied', 'Нет доступа к этому документу')
        return { ticket: ctx.tickets.issue(space, s.device.id) }
      },
      'media.missing': async (p, s) => {
        const space = uuid(p, 'space')
        if (!(await spaces().roleOf(space, s.device.id))) throw new RpcFail('denied', 'Нет доступа к этому документу')
        // never cut silently: the app would take the files left out for ones the server has
        if (Array.isArray(p.rels) && p.rels.length > MEDIA_RELS_MAX) throw new RpcFail('limit', `Не больше ${MEDIA_RELS_MAX} файлов за раз`)
        const rels = Array.isArray(p.rels) ? p.rels.filter((r): r is string => typeof r === 'string' && isSpaceFile(r)) : []
        const have = new Set((await ctx.db.rows<{ rel: string }>('select rel from space_media where space = $1 and rel = any($2::text[])', [space, rels])).map((r) => r.rel))
        return rels.filter((r) => !have.has(r))
      },
    },
  }
}
