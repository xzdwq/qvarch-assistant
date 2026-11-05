import { mkdirSync } from 'node:fs'
import { readJsonFile, writeAtomic } from '../fsAtomic'
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
    const c = readJsonFile<unknown>(this.file)
    return isChatCacheData(c) ? c : null
  }
  save(c: unknown): void {
    if (!isChatCacheData(c)) throw new Error('Кэш чатов не подходит')
    const text = JSON.stringify(c)
    if (text.length * 2 > CHAT_CACHE_MAX_BYTES * 1.5) throw new Error('Кэш чатов слишком большой')
    mkdirSync(dirname(this.file), { recursive: true })
    writeAtomic(this.file, text)
  }
}
