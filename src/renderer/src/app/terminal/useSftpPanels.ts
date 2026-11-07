import { reactive, ref, watch } from 'vue'
import type { TermSession } from '@shared/terminal'
import type { RemoteEntry, RemoteListing } from '@shared/ssh/remoteFiles'
import { joinRemote, parentRemote } from '@shared/ssh/remotePath'
import { needsPassword } from '@shared/ssh/api'
import { remoteError } from '@shared/remoteError'
import { lineClearKey } from '@shared/terminal'
import { shellQuote } from '@shared/ssh/remoteShell'
import { ensureConnected, useSshSessions, useSshTransfers } from '../../lib/ssh'
import type { TermShells } from './useTermShells'

/** One SSH tab's file explorer: where it is, what is there, what is picked, what is being named. */
export interface Explorer {
  tabId: string
  sessionId: string
  path: string
  listing?: RemoteListing
  loading: boolean
  error: string
  selected: Set<string>
  /** A name being typed: a new folder, or an entry renamed. */
  naming?: { kind: 'mkdir' | 'rename'; entry?: RemoteEntry; value: string }
  /** It and the terminal go together: the terminal's folder followed, a folder opened here typed in as `cd`. */
  sync: boolean
  /** Opened at the session's own folder: the terminal is taken there once its folder is known (not the other way). */
  lead: boolean
}
/** Who moved the explorer: the person (the terminal follows), the terminal (it follows), its opening (neither). */
type MovedBy = 'person' | 'terminal' | 'start'

const PREFS_KEY = 'qa.term.sftp'
const readPrefs = (): { width?: number; hidden?: boolean } => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { width?: number; hidden?: boolean }
  } catch {
    return {}
  }
}

/**
 * The file explorers beside the SSH tabs (as MobaXterm's): one per tab, opened at the session's folder (else the
 * home); listing, going in and up, new folder, rename, remove, upload (dropped from Windows' Explorer or picked),
 * download, open. A connection that needs a password asks for it and the action is tried once more.
 */
export function useSftpPanels(shells: TermShells) {
  const explorers = reactive(new Map<string, Explorer>())
  const sshSessions = useSshSessions()
  const saved = readPrefs()
  const width = ref(saved.width ?? 340)
  /** The explorers hidden (the terminal takes the width). */
  const hidden = ref(!!saved.hidden)
  watch([width, hidden], () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ width: width.value, hidden: hidden.value }))
    } catch {
      // fine
    }
  })

  /** A call to the server, connected first (a password asked when needed) and tried once more after that. */
  async function withConnection<T>(ex: Explorer, fn: () => Promise<T>): Promise<T | undefined> {
    ex.error = ''
    try {
      return await fn()
    } catch (e) {
      const msg = remoteError(e)
      if (!needsPassword(msg)) {
        ex.error = msg
        return undefined
      }
    }
    try {
      if (!(await ensureConnected(ex.sessionId))) return undefined
      return await fn()
    } catch (e) {
      ex.error = remoteError(e)
      return undefined
    }
  }

  /** The explorer of an SSH tab (made at its first showing — then it opens its folder). */
  function explorerOf(s: TermSession): Explorer | undefined {
    if (!s.ssh) return undefined
    let ex = explorers.get(s.id)
    if (!ex) {
      const own = !!sshSessions.value.find((x) => x.id === s.ssh!.id)?.startDir
      ex = reactive<Explorer>({ tabId: s.id, sessionId: s.ssh.id, path: '', loading: false, error: '', selected: new Set(), sync: true, lead: own })
      explorers.set(s.id, ex)
      void start(ex)
    }
    return ex
  }
  async function start(ex: Explorer, by: MovedBy = 'start'): Promise<void> {
    ex.loading = true
    const dir = await withConnection(ex, () => window.qa.ssh('startDir', ex.sessionId))
    ex.loading = false
    if (dir) await go(ex, dir, by)
  }
  /**
   * Into a folder (its listing replaces the one shown only when it came — a failed one leaves it). The same folder
   * read again keeps what is picked and the name being typed; moved by the person — the terminal follows.
   */
  async function go(ex: Explorer, path: string, by: MovedBy = 'person'): Promise<void> {
    ex.loading = true
    const l = await withConnection(ex, () => window.qa.ssh('list', ex.sessionId, path))
    ex.loading = false
    if (!l) return
    const same = l.path === ex.path
    ex.listing = l
    ex.path = l.path
    if (same) ex.selected = new Set(l.entries.filter((e) => ex.selected.has(e.path)).map((e) => e.path))
    else {
      ex.selected = new Set()
      ex.naming = undefined
    }
    if (by === 'person') tellTerminal(ex)
  }
  const refresh = (ex: Explorer) => (ex.path ? go(ex, ex.path, 'start') : start(ex))
  const up = (ex: Explorer) => go(ex, parentRemote(ex.path))
  const home = (ex: Explorer) => start(ex, 'person')

  /** The terminal taken to the explorer's folder (`cd`): only when they go together and nothing runs in it. */
  function tellTerminal(ex: Explorer): void {
    const s = shells.byId(ex.tabId)
    if (!ex.sync || !s?.ssh || !s.info.cwd || s.busy || s.info.cwd === ex.path) return
    window.qa.termWrite(ex.tabId, `${lineClearKey(s)}cd ${shellQuote(ex.path)}\r`)
  }
  /**
   * The terminal told its folder (a prompt): the explorer goes there; the same folder — read again (a command may
   * have changed it). Opened at the session's own folder — the terminal is taken there the first time instead.
   */
  function followTerminal(ex: Explorer, cwd: string): void {
    if (!ex.sync || !cwd) return
    // (a listing on its way: the folder is followed once it came)
    if (ex.loading) return void setTimeout(() => followTerminal(ex, cwd), 300)
    if (ex.lead && ex.path) {
      ex.lead = false
      return tellTerminal(ex)
    }
    ex.lead = false
    void go(ex, cwd, 'terminal')
  }
  /** Going together switched on: the explorer goes to the terminal's folder. */
  function setSync(ex: Explorer, on: boolean): void {
    ex.sync = on
    const cwd = shells.byId(ex.tabId)?.info.cwd
    if (on && cwd) void go(ex, cwd, 'terminal')
  }

  // a file uploaded into a folder an explorer shows: that explorer reads its folder again (once for a batch)
  const seenDone = new Set<string>()
  const refreshSoon = new Map<string, ReturnType<typeof setTimeout>>()
  watch(useSshTransfers(), (list) => {
    for (const t of list) {
      if (t.state !== 'done' || t.dir !== 'up' || seenDone.has(t.id)) continue
      seenDone.add(t.id)
      for (const ex of explorers.values()) {
        if (ex.sessionId !== t.sessionId || !ex.path || !(t.to === ex.path || t.to.startsWith(ex.path === '/' ? '/' : `${ex.path}/`))) continue
        clearTimeout(refreshSoon.get(ex.tabId))
        refreshSoon.set(ex.tabId, setTimeout(() => void refresh(ex), 400))
      }
    }
  })

  /** An entry opened: a folder (a link to one too) — gone into; a file — brought over and opened by Windows. */
  async function open(ex: Explorer, e: RemoteEntry): Promise<void> {
    if (e.kind === 'dir' || e.toDir) return go(ex, e.path)
    await withConnection(ex, () => window.qa.ssh('open', ex.sessionId, e.path))
  }

  /** The entries picked (the one clicked when nothing is). */
  const picked = (ex: Explorer, e?: RemoteEntry) => {
    const list = ex.listing?.entries.filter((x) => ex.selected.has(x.path)) ?? []
    return list.length ? list : e ? [e] : []
  }
  function select(ex: Explorer, e: RemoteEntry, toggle: boolean): void {
    const next = new Set(toggle ? ex.selected : [])
    if (toggle && next.has(e.path)) next.delete(e.path)
    else next.add(e.path)
    ex.selected = next
  }

  async function download(ex: Explorer, list: RemoteEntry[], pickFolder: boolean): Promise<void> {
    if (!list.length) return
    const dir = pickFolder ? await window.qa.ssh('pickFolder') : undefined
    if (pickFolder && !dir) return
    await withConnection(ex, () => window.qa.ssh('download', ex.sessionId, list.map((e) => e.path), dir))
  }
  async function upload(ex: Explorer, localPaths: string[]): Promise<void> {
    if (!localPaths.length || !ex.path) return
    await withConnection(ex, () => window.qa.ssh('upload', ex.sessionId, localPaths, ex.path))
  }
  async function pickUpload(ex: Explorer): Promise<void> {
    await upload(ex, await window.qa.ssh('pickFiles'))
  }
  /** Files dropped from Windows' Explorer onto the list. */
  function drop(ex: Explorer, ev: DragEvent): void {
    const paths = [...(ev.dataTransfer?.files ?? [])].map((f) => window.qa.pathForFile(f)).filter(Boolean)
    void upload(ex, paths)
  }

  function startNaming(ex: Explorer, kind: 'mkdir' | 'rename', entry?: RemoteEntry): void {
    ex.naming = { kind, entry, value: entry?.name ?? '' }
  }
  /** The name typed: the folder made / the entry renamed, the listing read again. */
  async function finishNaming(ex: Explorer): Promise<void> {
    const n = ex.naming
    const name = n?.value.trim()
    ex.naming = undefined
    if (!n || !name || /[/\\]/.test(name) || name === n.entry?.name) return
    const to = joinRemote(ex.path, name)
    const ok = await withConnection(ex, () => (n.kind === 'mkdir' ? window.qa.ssh('mkdir', ex.sessionId, to) : window.qa.ssh('rename', ex.sessionId, n.entry!.path, to)).then(() => true))
    if (ok) await refresh(ex)
  }
  async function remove(ex: Explorer, list: RemoteEntry[]): Promise<void> {
    if (!list.length) return
    const what = list.length === 1 ? `«${list[0].name}»${list[0].kind === 'dir' ? ' со всем содержимым' : ''}` : `${list.length} элементов (папки — со всем содержимым)`
    if (!confirm(`Удалить на сервере ${what}?`)) return
    for (const e of list) if ((await withConnection(ex, () => window.qa.ssh('remove', ex.sessionId, e.path).then(() => true))) !== true) break
    await refresh(ex)
  }

  /** A tab closed: its explorer forgotten. */
  function forget(tabId: string): void {
    explorers.delete(tabId)
  }
  return { explorers, width, hidden, explorerOf, go, refresh, up, home, followTerminal, setSync, open, picked, select, download, upload, pickUpload, drop, startNaming, finishNaming, remove, forget }
}
export type SftpPanels = ReturnType<typeof useSftpPanels>
