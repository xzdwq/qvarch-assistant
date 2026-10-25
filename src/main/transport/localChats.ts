import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLocalChat, type LocalChat } from '../../shared/transport/localChat'

/**
 * The chats kept on this computer only (one's own, with one's agents — no server needed): a file each
 * (data/local-chats/<id>.json). One brought to the server (a person added) is taken away here.
 */
export class LocalChats {
  private readonly dir: string
  constructor(root: string) {
    this.dir = join(root, 'local-chats')
  }
  private file(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Неверный id чата')
    return join(this.dir, `${id}.json`)
  }
  list(): LocalChat[] {
    if (!existsSync(this.dir)) return []
    const out: LocalChat[] = []
    for (const f of readdirSync(this.dir).filter((x) => x.endsWith('.json')))
      try {
        const c: unknown = JSON.parse(readFileSync(join(this.dir, f), 'utf8'))
        if (isLocalChat(c)) out.push(c)
      } catch {
        // a broken file — skipped
      }
    return out
  }
  save(c: LocalChat): void {
    if (!isLocalChat(c)) throw new Error('Чат не подходит')
    mkdirSync(this.dir, { recursive: true })
    const file = this.file(c.id)
    writeFileSync(`${file}.tmp`, JSON.stringify(c))
    renameSync(`${file}.tmp`, file)
  }
  drop(id: string): void {
    rmSync(this.file(id), { force: true })
  }
}
