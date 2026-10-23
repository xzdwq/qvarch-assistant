import { ref, shallowRef } from 'vue'
import type { BrowserTab, CertInfo } from '@shared/browser'
import { bLayout, hostOf } from '../../lib/browser'

/**
 * A page's own tools: its navigation and zoom, its connection (the lock before the address), its site's data reset,
 * the rulers; a site's sign-in asked; a download's news; files and links dropped on the section — each a tab.
 */
export function useSiteTools(deps: { byId: (id?: string) => BrowserTab | undefined; newTab: (pi?: number, url?: string) => Promise<string> }) {
  const { byId } = deps
  const nav = (id: string, a: 'back' | 'fwd' | 'reload' | 'stop' | 'devtools') => void window.qa.browser('nav', id, a)
  const zoom = (id: string, z: number) => void window.qa.browser('zoom', id, z)
  /** A bad certificate accepted: the page opened anyway. */
  const trust = (id: string, host: string) => void window.qa.browser('trust', id, host)
  /** A downloaded file shown in its folder. */
  const reveal = (path: string) => void window.qa.browser('reveal', path)
  function toggleRuler(id: string): void {
    void window.qa.browser('ruler', id, !byId(id)?.ruler)
  }
  function resetSite(id: string): void {
    const host = hostOf(byId(id)?.url ?? '')
    if (confirm(`Сбросить всё, что сайт ${host} сохранил в этом браузере — кэш, куки (вход на сайт), localStorage, IndexedDB, service workers — и перезагрузить страницу?`)) void window.qa.browser('resetSite', id)
  }

  // ---------- the site's connection (the icon before the address) ----------
  /** The connection shown (CertPopover): what it is, and the lock it opened from. */
  const cert = shallowRef<{ info: CertInfo; anchor: HTMLElement }>()
  async function showCert(id: string, e: MouseEvent): Promise<void> {
    if (cert.value) return void (cert.value = undefined)
    const anchor = e.currentTarget as HTMLElement
    const info = await window.qa.browser('certInfo', id)
    if (info) cert.value = { info, anchor }
  }
  const certCls = (id?: string) => {
    const u = byId(id)?.url ?? ''
    return u.startsWith('https:') ? 'sec' : u.startsWith('http:') ? 'insec' : ''
  }

  // ---------- sign-in, downloads ----------
  const login = ref<{ reqId: string; tabId: string; host: string; realm: string; user: string; pass: string }>()
  function loginDone(ok: boolean): void {
    const l = login.value
    login.value = undefined
    if (l) window.qa.browser('loginReply', l.reqId, ok ? l.user : undefined, ok ? l.pass : undefined)
  }
  const download = ref<{ name: string; path: string; state: string }>()

  // ---------- files dropped on the section: each in a tab of its own ----------
  function onDragOver(e: DragEvent): void {
    if (e.dataTransfer?.types.includes('Files') || e.dataTransfer?.types.includes('text/uri-list')) {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
  }
  function onDrop(e: DragEvent): void {
    const dt = e.dataTransfer
    if (!dt) return
    const files = [...dt.files]
    const links = (dt.getData('text/uri-list') || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
    if (!files.length && !links.length) return
    e.preventDefault()
    for (const f of files) {
      const path = window.qa.pathForFile(f)
      if (path) void deps.newTab(bLayout.cur, `file:///${encodeURI(path.replace(/\\/g, '/'))}`)
    }
    for (const u of links) void deps.newTab(bLayout.cur, u)
  }
  return { nav, zoom, trust, reveal, toggleRuler, resetSite, cert, showCert, certCls, login, loginDone, download, onDragOver, onDrop }
}
