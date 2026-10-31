import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CHAT_CACHE_MAX_BYTES, isChatCacheData, type ChatCacheData } from '../../shared/transport/chatOffline'

/**
 * The server's chats as last seen, kept on the computer (data/chat-cache.json): the app started with no server shows
 * them and one goes on talking there (with one's agents).
 */
export class ChatCache {
  private readonly file: string
  constructor(root: string) {
    this.file = join(root, 'chat-cache.json')
  }
  load(): ChatCacheData | null {
    if (!existsSync(this.file)) return null
    try {
      const c: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      return isChatCacheData(c) ? c : null
    } catch {
      return null
    }
  }
  save(c: unknown): void {
    if (!isChatCacheData(c)) throw new Error('Кэш чатов не подходит')
    const text = JSON.stringify(c)
    if (text.length * 2 > CHAT_CACHE_MAX_BYTES * 1.5) throw new Error('Кэш чатов слишком большой')
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(`${this.file}.tmp`, text)
    renameSync(`${this.file}.tmp`, this.file)
  }
}
