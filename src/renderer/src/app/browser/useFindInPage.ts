import { nextTick, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { shortcutLetter } from '@shared/browser/shortcutKey'
import { bLayout } from '../../lib/browser'
import type { useBrowserTabs } from './useBrowserTabs'

type Tabs = Pick<ReturnType<typeof useBrowserTabs>, 'byId' | 'pageShown' | 'focusPage'>

/**
 * Ctrl+F: text searched on a pane's page — its bar under the address line (a page is a native layer: nothing of the
 * window can stand over it), every match marked, Enter / Shift+Enter — the next / previous one, Esc — closed, the
 * page takes the keyboard back. One search at a time, on the tab it was opened on: another tab shown there — it ends;
 * the page loaded anew — searched again.
 */
export function useFindInPage(deps: Tabs & { active: () => boolean }) {
  const find = reactive({ pane: undefined as string | undefined, tab: '', text: '', active: 0, total: 0 })
  const inputs = new Map<string, HTMLInputElement>()

  function search(forward: boolean, next: boolean): void {
    if (!find.text) find.active = find.total = 0
    void window.qa.browser('find', find.tab, find.text, forward, next)
  }
  /** The bar opened on a pane's shown page (open already — its text selected to type anew). */
  function openFind(pi: number): void {
    const p = bLayout.panes[pi]
    const tab = p?.active
    if (!p || !tab || !deps.pageShown(tab)) return
    if (find.pane && find.tab !== tab) void window.qa.browser('findStop', find.tab)
    const again = find.tab === tab && !!find.text
    find.pane = p.id
    find.tab = tab
    void nextTick(() => {
      const el = inputs.get(p.id)
      el?.focus()
      el?.select()
    })
    if (again) search(true, false)
  }
  /** The bar closed (`back` — the page takes the keyboard). */
  function closeFind(back = true): void {
    if (!find.pane) return
    void window.qa.browser('findStop', find.tab)
    find.pane = undefined
    find.active = find.total = 0
    if (back) deps.focusPage(find.tab)
  }
  function onFindInput(text: string): void {
    find.text = text
    search(true, false)
  }
  function onFindKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') return (e.preventDefault(), closeFind())
    if (e.key !== 'Enter') return
    e.preventDefault()
    step(!e.shiftKey)
  }
  /** The next / previous match (Enter, Shift+Enter, the buttons). */
  function step(forward: boolean): void {
    if (find.text) search(forward, true)
  }

  // another tab shown in the pane (or the tab closed): the search ends there
  watch(
    () => bLayout.panes.find((p) => p.id === find.pane)?.active,
    (tab) => find.pane && tab !== find.tab && closeFind(false),
  )
  // the page loaded anew (a link, a reload): searched again
  watch(
    () => deps.byId(find.tab)?.loading,
    (loading, was) => find.pane && was && !loading && find.text && search(true, false),
  )
  /** The counts of the tab searched (main's `found`). */
  function onFound(p: { id: string; active: number; total: number }): void {
    if (p.id !== find.tab) return
    find.active = p.active
    find.total = p.total
  }
  // Ctrl+F in the window (the address line, the bars); a page's own comes from main
  function onKey(e: KeyboardEvent): void {
    if (!deps.active() || !(e.ctrlKey || e.metaKey) || e.altKey || shortcutLetter(e.key, e.code) !== 'f') return
    e.preventDefault()
    openFind(bLayout.cur)
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
  return { find, inputs, openFind, closeFind, onFindInput, onFindKey, step, onFound }
}
