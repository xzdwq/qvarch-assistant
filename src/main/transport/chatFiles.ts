import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_FILE_MAX, cleanFileName, type ChatFile } from '../../shared/transport/chat'
import { CHAT_FILES_PATH, FILE_NAME_HEADER, TICKET_HEADER } from '../../shared/transport/protocol'
import type { SpacePasses } from './spacePasses'

const ID = /^[0-9a-f-]{36}$/

/**
 * The files of the chats on this computer: one sent goes to the server (with the room's pass) and is kept here; one
 * fetched once is kept too (a file of a chat never changes) — shown again without the server.
 */
export class ChatFiles {
  constructor(
    /** The rooms' passes (`chat.fileTicket`). */
    private readonly passes: SpacePasses,
    /** The server's HTTP address (`http://host:port`), none — offline. */
    private readonly base: () => string | undefined,
    /** Where the files are kept. */
    private readonly dir: string,
  ) {}

  private url(room: string, id: string): string {
    const base = this.base()
    if (!base) throw new Error('Сервер не подключён')
    if (!ID.test(room) || !ID.test(id)) throw new Error('Неверный файл')
    return `${base}${CHAT_FILES_PATH}${room}/${id}`
  }
  private kept(id: string): string {
    if (!ID.test(id)) throw new Error('Неверный файл')
    return join(this.dir, id)
  }
  private keep(id: string, bytes: Uint8Array): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.kept(id), bytes)
  }

  /** A file sent into a room: what a message carries of it. */
  async put(room: string, name: string, mime: string, bytes: Uint8Array): Promise<ChatFile> {
    if (bytes.byteLength > CHAT_FILE_MAX) throw new Error(`Файл больше ${CHAT_FILE_MAX / 1024 / 1024} МБ`)
    const id = randomUUID()
    const file: ChatFile = { id, name: cleanFileName(name), size: bytes.byteLength, mime: mime || 'application/octet-stream' }
    const url = this.url(room, id)
    const r = await this.passes.request(room, (pass) =>
      fetch(url, { method: 'PUT', body: Buffer.from(bytes), headers: { [TICKET_HEADER]: pass, 'content-type': file.mime, [FILE_NAME_HEADER]: encodeURIComponent(file.name) } }),
    )
    if (!r.ok) throw new Error(`Файл не отправлен: ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`)
    this.keep(id, bytes)
    return file
  }
  /** A file's bytes: kept here, else fetched (and kept). */
  async get(room: string, id: string): Promise<Uint8Array> {
    const here = this.kept(id)
    if (existsSync(here)) return new Uint8Array(readFileSync(here))
    const url = this.url(room, id)
    const r = await this.passes.request(room, (pass) => fetch(url, { headers: { [TICKET_HEADER]: pass } }))
    if (!r.ok) throw new Error(r.status === 404 ? 'Файла нет на сервере' : `Файл не получен: ${r.status}`)
    const bytes = new Uint8Array(await r.arrayBuffer())
    this.keep(id, bytes)
    return bytes
  }
}
