import type { IncomingMessage, ServerResponse } from 'node:http'
import { CHAT_FILE_MAX, cleanFileName, isChatFile, isFileKind, type ChatAttach } from '../../../../src/shared/transport/chat'
import { CHAT_FILES_PATH, FILE_NAME_HEADER, TICKET_HEADER } from '../../../../src/shared/transport/protocol'
import type { Db } from '../../db'
import { readBody, reply } from '../../httpUtil'
import { passOf } from '../../tickets'

/** The files sent into the chats: each of its room (gone with it), never changed once sent. */
export const CHAT_FILES_MIGRATION = `create table chat_files (
     id uuid primary key,
     room uuid not null references chat_rooms (id) on delete cascade,
     name text not null,
     mime text not null,
     size int not null,
     data bytea not null,
     created_by text not null references qa_devices (id),
     at timestamptz not null default now()
   );
   create index chat_files_room on chat_files (room);`

const MIME = /^[\w.+-]+\/[\w.+-]+$/
/** A header's encoded text (broken — as it came). */
function decoded(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * The chats' files over HTTP (too big for the socket): sent and fetched by the room's members only, with a pass of the
 * room the socket gives. A message carries a file by its id — only a file of its own room.
 */
export class ChatFiles {
  constructor(
    private readonly db: Db,
    private readonly isMember: (room: string, device: string) => Promise<boolean>,
  ) {}

  /** A message's attachment is fine: a file's — a file of this room (sent before). */
  async attachFits(room: string, a: ChatAttach): Promise<boolean> {
    if (!isFileKind(a.kind)) return true
    if (!isChatFile(a.data)) return false
    return !!(await this.db.one('select 1 from chat_files where id = $1 and room = $2', [a.data.id, room]))
  }

  async http(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith(CHAT_FILES_PATH)) return false
    const [room, id] = req.url.slice(CHAT_FILES_PATH.length).split('?')[0].split('/')
    if (!/^[0-9a-f-]{36}$/.test(room ?? '') || !/^[0-9a-f-]{36}$/.test(id ?? '')) return reply(res, 400, 'неверный путь')
    const device = passOf(req.headers[TICKET_HEADER] as string | undefined, room)
    if (!device || !(await this.isMember(room, device))) return reply(res, 403, 'нет доступа')
    if (req.method === 'GET') {
      const row = await this.db.one<{ data: Buffer; mime: string }>('select data, mime from chat_files where id = $1 and room = $2', [id, room])
      if (!row) return reply(res, 404, 'нет файла')
      res.writeHead(200, { 'content-type': row.mime, 'content-length': row.data.length, 'x-content-type-options': 'nosniff' })
      res.end(row.data)
      return true
    }
    if (req.method === 'PUT') {
      const name = cleanFileName(decoded(String(req.headers[FILE_NAME_HEADER] ?? '')))
      const type = String(req.headers['content-type'] ?? '')
      const mime = MIME.test(type) ? type : 'application/octet-stream'
      const body = await readBody(req, CHAT_FILE_MAX)
      if (!body) return reply(res, 413, 'файл слишком большой')
      await this.db.rows('insert into chat_files (id, room, name, mime, size, data, created_by) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing', [id, room, name, mime, body.length, body, device])
      return reply(res, 204)
    }
    return reply(res, 405)
  }
}
