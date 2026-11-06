import { safeStorage, type WebContents } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { writeAtomic } from '../fsAtomic'
import { join } from 'node:path'
import { browserId, PW_ANSWERS, type PasswordInfo, type PwAnswer } from '../../shared/browser'
import type { PageLogin } from '../../shared/browser/pageChannels'
import { toPage } from '../ipc/browserPageIpc'
import { isBrowserPopup } from './popupWindows'
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
  /** The kept file is there but could not be read (the OS encryption failed for a while): never overwritten. */
  private unreadable = false

  constructor(
    root: string,
    private host: BrowserHost,
  ) {
    this.file = join(root, 'browser-passwords.bin')
    try {
      if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) this.pw = JSON.parse(safeStorage.decryptString(readFileSync(this.file))) as typeof this.pw
    } catch (e) {
      this.unreadable = true
      console.error('[browser] saved passwords could not be read — the file is kept as it is', e)
    }
  }
  /** A page's sign-in form was sent: offer to keep it (the origin is the page's own, never what it says). */
  onSubmit(wc: WebContents, raw: unknown): void {
    const c = raw as { username?: unknown; password?: unknown } | undefined
    const origin = originOf(wc.getURL())
    const password = String(c?.password ?? '')
    const username = String(c?.username ?? '').slice(0, 200)
    if (!this.isBrowserPage(wc) || !origin || !password || password.length > 500 || this.pw.never.includes(origin)) return
    // the same form sent twice (submit + click) — once
    const key = `${origin}|${username}|${password}`
    if (key === this.last) return
    this.last = key
    const has = this.pw.list.find((x) => x.origin === origin && x.username === username)
    if (has?.password === password) return
    const askId = browserId()
    // one question shown at a time: a replaced one is never answered — its password is not kept in memory
    this.asks.clear()
    this.asks.set(askId, { origin, username, password })
    this.host.emit('pwAsk', { askId, origin, username, update: !!has })
  }
  /** A page of the browser: a tab's, or a popup a browser page opened (a sign-in window) — never anything else. */
  private isBrowserPage(wc: WebContents): boolean {
    return !!this.host.byContents(wc) || isBrowserPopup(wc)
  }
  /** A sign-in form on a browser page: its site's saved login, if any (the newest used). */
  loginFor(wc: WebContents): PageLogin | null {
    if (!this.isBrowserPage(wc)) return null
    const origin = originOf(wc.getURL())
    const hit = this.pw.list.filter((x) => x.origin === origin).sort((a, b) => (b.used ?? b.saved) - (a.used ?? a.saved))[0]
    if (!hit) return null
    hit.used = Date.now()
    return { username: hit.username, password: hit.password }
  }
  private save(): void {
    if (!safeStorage.isEncryptionAvailable() || this.unreadable) return
    writeAtomic(this.file, safeStorage.encryptString(JSON.stringify(this.pw)))
    this.host.emit('passwords', this.passwords())
  }
  /** The saved logins — without the passwords (those come one by one: reveal). */
  passwords(): PasswordInfo[] {
    return this.pw.list.map((x) => ({ id: x.id, origin: x.origin, username: x.username, saved: x.saved, used: x.used }))
  }
  answer(askId: string, answer: PwAnswer): void {
    const a = this.asks.get(askId)
    this.asks.delete(askId)
    // (an answer the window never offers keeps nothing)
    if (!a || answer === 'no' || !PW_ANSWERS.includes(answer)) return
    if (answer === 'never') {
      if (!this.pw.never.includes(a.origin)) this.pw.never.push(a.origin)
    } else {
      const has = this.pw.list.find((x) => x.origin === a.origin && x.username === a.username)
      if (has) Object.assign(has, { password: a.password, saved: Date.now() })
      else this.pw.list.push({ id: browserId(), ...a, saved: Date.now() })
    }
    this.save()
  }
  /** Logins brought from another browser: a site and name kept already — its password taken, else a new one. */
  importLogins(list: ReadonlyArray<{ origin: string; username: string; password: string }>): { added: number; updated: number } {
    let added = 0
    let updated = 0
    const now = Date.now()
    for (const l of list) {
      const has = this.pw.list.find((x) => x.origin === l.origin && x.username === l.username)
      if (has?.password === l.password) continue
      if (has) (Object.assign(has, { password: l.password, saved: now }), updated++)
      else (this.pw.list.push({ id: browserId(), origin: l.origin, username: l.username, password: l.password, saved: now }), added++)
    }
    if (added || updated) this.save()
    return { added, updated }
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
    toPage(t.view.webContents, 'pwFill', { username: s.username, password: s.password })
  }
  neverList(): string[] {
    return this.pw.never
  }
  neverRemove(origin: string): void {
    this.pw.never = this.pw.never.filter((x) => x !== origin)
    this.save()
  }
}
