import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { Bookmark, BrowserTab, RecItem, RecState } from '@shared/browser'

/** The browser's state from the main process: tabs, the recording, bookmarks — shared by the section and the status bar. */
export const tabs = shallowRef<BrowserTab[]>([])
export const recState = shallowRef<RecState>({ on: false, documents: false, count: 0 })
export const recItems = shallowRef<RecItem[]>([])
export const bookmarks = shallowRef<Bookmark[]>([])
export const tabsLoaded = ref(false)
type Listener = (type: string, payload: unknown) => void
const listeners = new Set<Listener>()
let started = false
export function startBrowser(): void {
  if (started) return
  started = true
  void window.qa.browser('list').then((l) => ((tabs.value = l), (tabsLoaded.value = true)))
  void window.qa.browser('recState').then((s) => (recState.value = s))
  void window.qa.browser('recList').then((l) => (recItems.value = l))
  void window.qa.browser('bookmarks').then((b) => (bookmarks.value = b))
  window.qa.onBrowser((type, p) => {
    if (type === 'tabs') tabs.value = p as BrowserTab[]
    else if (type === 'rec') {
      const r = p as { state: RecState; items: RecItem[] }
      recState.value = r.state
      recItems.value = r.items
    } else if (type === 'bookmarks') bookmarks.value = p as Bookmark[]
    // a tab the app opened (a recording, a link, a trace): shown in the current pane
    else if (type === 'activate') placeTab(bLayout.cur, (p as { id: string }).id)
    for (const l of listeners) l(type, p)
  })
}
/** The browser's other news (a tab opened by a page, a key in a page, a sign-in asked…). */
export function onBrowserEvent(l: Listener): void {
  startBrowser()
  onMounted(() => listeners.add(l))
  onBeforeUnmount(() => listeners.delete(l))
}

// ---------- the panes: one or two, each with its own tabs (like the terminal / the notebook) ----------
export interface BPane {
  id: string
  tabs: string[]
  active?: string
}
export interface BLayout {
  panes: BPane[]
  cur: number
  split: number
}
const KEY = 'qa.browser.layout'
function readLayout(): BLayout {
  const def: BLayout = { panes: [{ id: 'p1', tabs: [] }], cur: 0, split: 0.5 }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<BLayout> | null
    if (!v?.panes?.length) return def
    return { ...def, ...v, cur: Math.min(v.cur ?? 0, v.panes.length - 1) }
  } catch {
    return def
  }
}
export const bLayout = reactive<BLayout>(readLayout())
watch(
  bLayout,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(bLayout))
    } catch {
      // fine
    }
  },
  { deep: true },
)
/** The tabs follow the pages: closed ones go, ones nobody shows join the current pane, an empty second pane goes. */
export function syncLayout(list: BrowserTab[], adopt = true): void {
  const ids = new Set(list.map((t) => t.id))
  for (const p of bLayout.panes) {
    p.tabs = p.tabs.filter((t) => ids.has(t))
    if (!p.active || !p.tabs.includes(p.active)) p.active = p.tabs[p.tabs.length - 1]
  }
  if (!adopt) return
  const shown = new Set(bLayout.panes.flatMap((p) => p.tabs))
  const cur = bLayout.panes[bLayout.cur] ?? bLayout.panes[0]
  for (const t of list) if (!shown.has(t.id)) cur.tabs.push(t.id)
  if (!cur.active) cur.active = cur.tabs[0]
  if (bLayout.panes.length > 1) {
    const i = bLayout.panes.findIndex((p) => !p.tabs.length)
    if (i >= 0) {
      bLayout.panes.splice(i, 1)
      bLayout.cur = 0
    }
  }
}
/** A tab into a pane (next to its active one, or right after `after`), made active. */
export function placeTab(pi: number, id: string, after?: string): void {
  for (const p of bLayout.panes) p.tabs = p.tabs.filter((t) => t !== id)
  const p = bLayout.panes[pi] ?? bLayout.panes[0]
  const at = p.tabs.indexOf(after ?? p.active ?? '')
  p.tabs.splice(at < 0 ? p.tabs.length : at + 1, 0, id)
  p.active = id
  bLayout.cur = bLayout.panes.indexOf(p)
}
export function moveTab(from: number, id: string, to: number, index: number): void {
  const a = bLayout.panes[from]
  const b = bLayout.panes[to]
  if (!a || !b) return
  const i = a.tabs.indexOf(id)
  if (i < 0) return
  a.tabs.splice(i, 1)
  if (a === b) b.tabs.splice(index > i ? index - 1 : index, 0, id)
  else {
    b.tabs.splice(Math.min(index, b.tabs.length), 0, id)
    if (a.active === id) a.active = a.tabs[Math.min(i, a.tabs.length - 1)]
  }
  b.active = id
  bLayout.cur = to
  if (!a.tabs.length && bLayout.panes.length > 1 && a !== b) {
    bLayout.panes.splice(from, 1)
    bLayout.cur = 0
  }
}
export function splitWith(from: number, id: string, side: 'left' | 'right'): void {
  if (bLayout.panes.length > 1 || bLayout.panes[from].tabs.length < 2) return
  const pane: BPane = { id: `p${Date.now()}`, tabs: [] }
  if (side === 'right') {
    bLayout.panes.push(pane)
    moveTab(from, id, 1, 0)
  } else {
    bLayout.panes.unshift(pane)
    moveTab(from + 1, id, 0, 0)
  }
}

/**
 * Something of the app is open over the pages — a dialog or a menu teleported into <body>, a title bar menu:
 * the native pages would hide it, so they make way meanwhile.
 */
export function useOverlay() {
  const on = ref(false)
  let mo: MutationObserver | undefined
  let raf = 0
  const check = () => {
    raf = 0
    const app = document.getElementById('app')
    const body = [...document.body.children].some((el) => el !== app && el instanceof HTMLElement && el.tagName !== 'SCRIPT' && el.getClientRects().length > 0 && !el.classList.contains('bv-ignore'))
    on.value = body || !!document.querySelector('.titlebar .dropdown')
  }
  const schedule = () => (raf ||= requestAnimationFrame(check))
  onMounted(() => {
    mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true })
    const tb = document.querySelector('.titlebar')
    if (tb) mo.observe(tb, { childList: true, subtree: true })
    check()
  })
  onBeforeUnmount(() => {
    mo?.disconnect()
    if (raf) cancelAnimationFrame(raf)
  })
  return on
}

/** A host of a URL (or the URL itself). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
