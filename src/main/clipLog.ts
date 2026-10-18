import { clipboard, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClipState } from '../shared/clip'

/**
 * The clipboard's history: every text copied (anywhere in Windows), newest first, the last 1000. It is kept
 * encrypted (Windows DPAPI — this user only): copied passwords and tokens end up here too. What a password
 * manager marks as not for history (the Windows "ExcludeClipboardContentFromMonitorProcessing" format) is
 * skipped. Windows has no "copied" event for an app — the clipboard is looked at twice a second.
 */
const MAX = 1000
/** A text longer than this is not kept (a whole file pasted around is no clipboard history). */
const MAX_TEXT = 200_000
const POLL_MS = 500

export class ClipLog {
  private file: string
  private state: ClipState = { on: true, items: [] }
  private last = ''
  private timer?: NodeJS.Timeout
  private saveTimer?: NodeJS.Timeout

  constructor(
    root: string,
    private emit: (s: ClipState) => void,
  ) {
    this.file = join(root, 'clipboard.bin')
    this.read()
    // what is there now is not "copied while we watched"
    void this.current().then((t) => {
      this.last = t ?? ''
      if (this.state.on) this.start()
    })
  }
  private read(): void {
    try {
      if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) {
        const s = JSON.parse(safeStorage.decryptString(readFileSync(this.file))) as Partial<ClipState>
        this.state = { on: s.on ?? true, items: Array.isArray(s.items) ? s.items.slice(0, MAX) : [] }
      }
    } catch {
      this.state = { on: true, items: [] }
    }
  }
  private save(now = false): void {
    clearTimeout(this.saveTimer)
    const write = () => {
      // never as plain text: no encryption — nothing kept on disk
      if (!safeStorage.isEncryptionAvailable()) return
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(this.state)))
      renameSync(tmp, this.file)
    }
    if (now) write()
    else this.saveTimer = setTimeout(write, 1500)
  }
  private changed(): void {
    this.save()
    this.emit(this.get())
  }
  private start(): void {
    // the development pictures run on the real desktop: its clipboard is not theirs to keep
    if (process.env.QA_SNAP) return
    this.timer ??= setInterval(() => void this.poll(), POLL_MS)
  }
  private stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }
  /** The text on the clipboard, unless a password manager said it is not for history. */
  private async current(): Promise<string | undefined> {
    try {
      const os = (f: string) => `electron application/osclipboard;format="${f}"`
      if (await clipboard.has(os('ExcludeClipboardContentFromMonitorProcessing'))) return undefined
      // "CanIncludeInClipboardHistory" = 0: the app that copied it asks to keep it out of any history
      if (await clipboard.has(os('CanIncludeInClipboardHistory'))) {
        const item = (await clipboard.read())[0]
        const blob = item ? await item.getType(os('CanIncludeInClipboardHistory')).catch(() => undefined) : undefined
        if (blob instanceof Blob) {
          const v = new DataView(await blob.arrayBuffer())
          if (v.byteLength >= 4 && v.getUint32(0, true) === 0) return undefined
        }
      }
      return await clipboard.readText()
    } catch {
      return undefined
    }
  }
  private busy = false
  private async poll(): Promise<void> {
    // one look at a time (the clipboard answers asynchronously)
    if (this.busy) return
    this.busy = true
    try {
      const t = await this.current()
      if (t === undefined || t === this.last) return
      this.last = t
      if (!t.trim() || t.length > MAX_TEXT) return
      this.add(t)
    } finally {
      this.busy = false
    }
  }
  private add(text: string): void {
    const items = this.state.items
    const i = items.findIndex((x) => x.text === text)
    // copied again — it comes up, counted
    if (i >= 0) {
      const [x] = items.splice(i, 1)
      items.unshift({ ...x, at: Date.now(), count: x.count + 1 })
    } else items.unshift({ id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), text, at: Date.now(), count: 1 })
    if (items.length > MAX) items.length = MAX
    this.changed()
  }

  get(): ClipState {
    return { on: this.state.on, items: this.state.items }
  }
  async setOn(on: boolean): Promise<ClipState> {
    this.state.on = on
    if (on) {
      this.last = (await this.current()) ?? ''
      this.start()
    } else this.stop()
    this.changed()
    return this.get()
  }
  remove(id: string): void {
    this.state.items = this.state.items.filter((x) => x.id !== id)
    this.changed()
  }
  clear(): void {
    this.state.items = []
    this.save(true)
    this.emit(this.get())
  }
  /** A kept text back on the clipboard (it comes up in the list). */
  async copy(id: string): Promise<void> {
    const x = this.state.items.find((i) => i.id === id)
    if (!x) return
    await clipboard.writeText(x.text)
    this.last = x.text
    this.add(x.text)
  }
  flush(): void {
    this.stop()
    this.save(true)
  }
}
