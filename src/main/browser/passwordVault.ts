import { ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserId, type PasswordInfo } from '../../shared/browser'
import { originOf, type BrowserHost } from './tab'

interface Saved {
  id: string
  origin: string
  username: string
  password: string
  saved: number
  used?: number
}

/**
 * Saved passwords (encrypted by Windows, this user only): a page's sign-in form sent — offered to keep; a sign-in
 * form shown — filled with its site's login. The page's own preload talks to it; a site gets only its own login.
 */
export class PasswordVault {
  private file: string
  private pw: { list: Saved[]; never: string[] } = { list: [], never: [] }
  private asks = new Map<string, { origin: string; username: string; password: string }>()
  private last = ''

  constructor(
    root: string,
    private host: BrowserHost,
  ) {
    this.file = join(root, 'browser-passwords.bin')
    try {
      if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) this.pw = JSON.parse(safeStorage.decryptString(readFileSync(this.file))) as typeof this.pw
    } catch {
      this.pw = { list: [], never: [] }
    }
    // a page's sign-in form was sent: offer to keep it (the origin is the page's own, never what it says)
    ipcMain.on('qa:bpw-submit', (e, c: { username?: string; password?: string }) => {
      const t = this.host.byContents(e.sender)
      const origin = originOf(e.sender.getURL())
      const password = String(c?.password ?? '')
      const username = String(c?.username ?? '').slice(0, 200)
      if (!t || !origin || !password || password.length > 500 || this.pw.never.includes(origin)) return
      // the same form sent twice (submit + click) — once
      const key = `${origin}|${username}|${password}`
      if (key === this.last) return
      this.last = key
      const has = this.pw.list.find((x) => x.origin === origin && x.username === username)
      if (has?.password === password) return
      const askId = browserId()
      this.asks.set(askId, { origin, username, password })
      this.host.emit('pwAsk', { askId, origin, username, update: !!has })
    })
    // a sign-in form on a page: its saved login, if any (the newest used)
    ipcMain.handle('qa:bpw-get', (e) => {
      if (!this.host.byContents(e.sender)) return null
      const origin = originOf(e.sender.getURL())
      const hit = this.pw.list.filter((x) => x.origin === origin).sort((a, b) => (b.used ?? b.saved) - (a.used ?? a.saved))[0]
      if (!hit) return null
      hit.used = Date.now()
      return { username: hit.username, password: hit.password }
    })
  }
  private save(): void {
    if (!safeStorage.isEncryptionAvailable()) return
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(this.pw)))
    renameSync(tmp, this.file)
    this.host.emit('passwords', this.passwords())
  }
  /** The saved logins — without the passwords (those come one by one: reveal). */
  passwords(): PasswordInfo[] {
    return this.pw.list.map((x) => ({ id: x.id, origin: x.origin, username: x.username, saved: x.saved, used: x.used }))
  }
  answer(askId: string, answer: 'save' | 'no' | 'never'): void {
    const a = this.asks.get(askId)
    this.asks.delete(askId)
    if (!a || answer === 'no') return
    if (answer === 'never') {
      if (!this.pw.never.includes(a.origin)) this.pw.never.push(a.origin)
    } else {
      const has = this.pw.list.find((x) => x.origin === a.origin && x.username === a.username)
      if (has) Object.assign(has, { password: a.password, saved: Date.now() })
      else this.pw.list.push({ id: browserId(), ...a, saved: Date.now() })
    }
    this.save()
  }
  reveal(id: string): string {
    return this.pw.list.find((x) => x.id === id)?.password ?? ''
  }
  remove(id: string): void {
    this.pw.list = this.pw.list.filter((x) => x.id !== id)
    this.save()
  }
  /** A saved login typed into the tab's sign-in form (the page must be that site). */
  fill(tabId: string, id: string): void {
    const t = this.host.tabs.get(tabId)
    const s = this.pw.list.find((x) => x.id === id)
    if (!t || !s || originOf(t.view.webContents.getURL()) !== s.origin) return
    s.used = Date.now()
    t.view.webContents.send('qa:bpw-fill', { username: s.username, password: s.password })
  }
  neverList(): string[] {
    return this.pw.never
  }
  neverRemove(origin: string): void {
    this.pw.never = this.pw.never.filter((x) => x !== origin)
    this.save()
  }
}
