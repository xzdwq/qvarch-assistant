import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { bLayout, placeTab, syncLayout, tabs, tabsLoaded } from '../../lib/browser'

/** The open pages are remembered (their addresses by pane) and opened again on the next start. */
const SESSION = 'qa.browser.session'
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
  function closeTab(id: string): void {
    void window.qa.browser('close', id)
  }
  let restored = false
  // no tab left (all closed) — a blank one
  watch(
    () => tabsLoaded.value && !tabs.value.length && !making,
    (empty) => empty && restored && void newTab(0),
  )
  onMounted(async () => {
    const list = await window.qa.browser('list')
    if (list.length) return void (restored = true)
    let saved: { panes: string[][]; active: number[] } | undefined
    try {
      saved = JSON.parse(localStorage.getItem(SESSION) ?? 'null') ?? undefined
    } catch {
      saved = undefined
    }
    making++
    try {
      bLayout.panes.splice(0, bLayout.panes.length, { id: 'p1', tabs: [] })
      bLayout.cur = 0
      const panes = saved?.panes?.filter((p) => p.length).slice(0, 2) ?? []
      if (!panes.length) panes.push([''])
      for (let pi = 0; pi < panes.length; pi++) {
        if (pi > 0) bLayout.panes.push({ id: `p${Date.now()}`, tabs: [] })
        for (const url of panes[pi]) {
          const t = await window.qa.browser('create', isBlank(url) ? undefined : url)
          placeTab(pi, t.id)
        }
        const p = bLayout.panes[pi]
        p.active = p.tabs[Math.min(saved?.active?.[pi] ?? 0, p.tabs.length - 1)]
      }
      bLayout.cur = 0
    } finally {
      making--
      restored = true
    }
  })
  watch(
    () => bLayout.panes.map((p) => ({ urls: p.tabs.map((id) => byId(id)?.url ?? ''), active: Math.max(0, p.tabs.indexOf(p.active ?? '')) })),
    (v) => {
      if (!restored) return
      try {
        localStorage.setItem(SESSION, JSON.stringify({ panes: v.map((x) => x.urls), active: v.map((x) => x.active) }))
      } catch {
        // fine
      }
    },
    { deep: true },
  )
  function show(pi: number, id: string): void {
    bLayout.panes[pi].active = id
    bLayout.cur = pi
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
    t: (e) => (e.preventDefault(), void newTab()),
    w: (e) => {
      if (!curId.value) return
      e.preventDefault()
      closeTab(curId.value)
    },
    l: (e) => (e.preventDefault(), void deps.focusUrl(bLayout.cur)),
  }
  function onKey(e: KeyboardEvent): void {
    if (!deps.active() || !(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (Object.hasOwn(CTRL_KEYS, k)) CTRL_KEYS[k](e)
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
  return { byId, isBlank, pageShown, curId, newTab, closeTab, show, toggleSplit, paneOf, openUrl }
}
