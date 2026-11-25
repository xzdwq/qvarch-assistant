import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { cleanSession, type BrowserSession } from '@shared/browser'
import { shortcutLetter } from '@shared/browser/shortcutKey'
import { bLayout, placeTab, syncLayout, tabs, tabsLoaded } from '../../lib/browser'

/** Where the open tabs were kept before main kept them: read once (then main has them) and dropped. */
const LEGACY_SESSION = 'qa.browser.session'
function legacySession(): BrowserSession | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(LEGACY_SESSION) ?? 'null') as { panes?: unknown[]; active?: unknown[] } | null
    localStorage.removeItem(LEGACY_SESSION)
    return cleanSession({ panes: v?.panes?.map((urls, i) => ({ urls, active: v.active?.[i] })) })
  } catch {
    return undefined
  }
}
export const isBlank = (url?: string) => !url || url === 'about:blank'

/**
 * The section's tabs in one or two panes (each pane its own tabs, like the terminal): made, closed, shown, the
 * panes split and joined; the session remembered and opened again; the section's own keys.
 */
export function useBrowserTabs(deps: { active: () => boolean; focusUrl: (pi: number) => Promise<void> }) {
  const byId = (id?: string) => tabs.value.find((t) => t.id === id)
  /** A pane shows its page (a tab with an address, opened fine); else the start page / the error. */
  const pageShown = (id?: string) => {
    const t = byId(id)
    return !!t && !isBlank(t.url) && !t.error
  }
  let making = 0
  watch([tabs, tabsLoaded], ([list, ok]) => ok && syncLayout(list, !making), { immediate: true })
  const curId = computed(() => bLayout.panes[bLayout.cur]?.active)
  async function newTab(pi = bLayout.cur, url?: string, after?: string): Promise<string> {
    making++
    try {
      const t = await window.qa.browser('create', url)
      placeTab(Math.min(pi, bLayout.panes.length - 1), t.id, after)
      if (!url) await deps.focusUrl(Math.min(pi, bLayout.panes.length - 1))
      return t.id
    } finally {
      making--
    }
  }
  /** A tab closed by the person: main keeps it with its place («Недавно закрытые», Ctrl+Shift+T). */
  function closeTab(id: string): void {
    const pi = paneOf(id)
    void window.qa.browser('close', id, pi >= 0 ? { pane: pi, index: bLayout.panes[pi].tabs.indexOf(id) } : undefined)
  }
  /**
   * A closed tab opened again where it was (its pane gone — in the current one): the one named, or the last closed.
   * (main keeps the list: it outlives the section's leaving and the app's restart)
   */
  async function reopenTab(closedId?: string): Promise<void> {
    const c = await window.qa.browser('takeClosed', closedId)
    if (!c) return
    making++
    try {
      const t = await window.qa.browser('create', c.url)
      const pi = c.pane !== undefined && bLayout.panes[c.pane] ? c.pane : bLayout.cur
      placeTab(pi, t.id, undefined, c.pane === pi ? c.index : undefined)
    } finally {
      making--
    }
  }
  let restored = false
  // no tab left (all closed) — a blank one
  watch(
    () => tabsLoaded.value && !tabs.value.length && !making,
    (empty) => empty && restored && void newTab(0),
  )
  // the last run's tabs opened again — once a run (main gives them once: a window reloaded finds its tabs open)
  onMounted(async () => {
    // (the old place read and dropped either way: a window reloaded later must not find it)
    const legacy = legacySession()
    const saved = (await window.qa.browser('takeSession')) ?? legacy
    const list = await window.qa.browser('list')
    if (!saved && list.length) return void (restored = true)
    making++
    try {
      bLayout.panes.splice(0, bLayout.panes.length, { id: 'p1', tabs: [] })
      bLayout.cur = 0
      const panes = saved?.panes ?? (list.length ? [] : [{ urls: [''], active: 0 }])
      for (let pi = 0; pi < panes.length; pi++) {
        if (pi > 0) bLayout.panes.push({ id: `p${Date.now()}`, tabs: [] })
        for (const url of panes[pi].urls) {
          const t = await window.qa.browser('create', isBlank(url) ? undefined : url)
          placeTab(pi, t.id)
        }
        const p = bLayout.panes[pi]
        p.active = p.tabs[Math.min(panes[pi].active, p.tabs.length - 1)]
      }
      // tabs the app opened before the section was shown (a link from a note, a trace): after them, the last one shown
      for (const t of list) placeTab(0, t.id)
      bLayout.cur = 0
    } finally {
      making--
      restored = true
    }
  })
  // the open tabs kept by main as they change (main hears it only after the last run's were taken, not while quitting)
  watch(
    () => bLayout.panes.map((p) => ({ urls: p.tabs.map((id) => byId(id)?.url ?? ''), active: Math.max(0, p.tabs.indexOf(p.active ?? '')) })),
    (panes) => restored && void window.qa.browser('saveSession', { panes }),
    { deep: true },
  )
  function show(pi: number, id: string): void {
    bLayout.panes[pi].active = id
    bLayout.cur = pi
  }
  /** A tab's page takes the keyboard (a start page / an error has none — the window keeps it). */
  function focusPage(id: string): void {
    if (pageShown(id)) window.qa.browser('focusPage', id)
  }
  async function toggleSplit(): Promise<void> {
    if (bLayout.panes.length > 1) {
      const [a, b] = bLayout.panes
      for (const t of b.tabs) if (!a.tabs.includes(t)) a.tabs.push(t)
      bLayout.panes.splice(1, 1)
      bLayout.cur = 0
      return
    }
    bLayout.panes.push({ id: `p${Date.now()}`, tabs: [] })
    making++
    try {
      await newTab(1)
    } finally {
      making--
    }
  }
  const paneOf = (id: string) => bLayout.panes.findIndex((p) => p.tabs.includes(id))
  /** A link from a bookmark / the start page: into the current tab (or a new one). */
  function openUrl(url: string, inNew = false): void {
    const id = curId.value
    if (!id || inNew) void newTab(bLayout.cur, url)
    else window.qa.browser('go', id, url)
  }
  // keys of the section itself (the pages send theirs from the main process)
  /** Ctrl + a key: a new tab, the tab closed (when there is one), the address line. */
  const CTRL_KEYS: Record<string, (e: KeyboardEvent) => void> = {
    t: (e) => (e.preventDefault(), void (e.shiftKey ? reopenTab() : newTab())),
    w: (e) => {
      if (!curId.value) return
      e.preventDefault()
      closeTab(curId.value)
    },
    l: (e) => (e.preventDefault(), void deps.focusUrl(bLayout.cur)),
  }
  function onKey(e: KeyboardEvent): void {
    if (!deps.active() || !(e.ctrlKey || e.metaKey)) return
    // (a letter by its place: Ctrl+Shift+T works in a Russian layout too)
    const k = shortcutLetter(e.key, e.code)
    if (Object.hasOwn(CTRL_KEYS, k)) CTRL_KEYS[k](e)
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
  return { byId, isBlank, pageShown, curId, newTab, closeTab, reopenTab, show, focusPage, toggleSplit, paneOf, openUrl }
}
