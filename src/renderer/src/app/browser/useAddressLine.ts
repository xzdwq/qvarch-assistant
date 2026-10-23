import { nextTick, reactive, ref, watch } from 'vue'
import type { BrowserTab } from '@shared/browser'
import { toUrl } from '@shared/browser'
import { bLayout } from '../../lib/browser'

type Suggestion = { url: string; title: string; bookmark: boolean }

/**
 * Each pane's address line: what is typed (kept while focus goes elsewhere), the suggestions under it (a popover of
 * PaneNavBar, as wide as the line), Enter — the address sent (a site taking it back is said), the address in parts.
 */
export function useAddressLine(deps: { byId: (id?: string) => BrowserTab | undefined; isBlank: (url?: string) => boolean; newTab: (pi?: number, url?: string) => Promise<string> }) {
  const { byId, isBlank } = deps
  /** What is typed in a pane's line (undefined — the page's own address shown). */
  const urlEdit = reactive<Record<string, string | undefined>>({})
  const urlEls = new Map<string, HTMLInputElement>()
  /** The line's box (the suggestions and the address in parts are placed by it). */
  const urlwEls = new Map<string, HTMLElement>()
  const suggestFor = ref<string>()
  const suggestions = ref<Suggestion[]>([])
  const sugIdx = ref(-1)
  let sugTimer: ReturnType<typeof setTimeout> | undefined
  function urlShown(pid: string, tabId?: string): string {
    const e = urlEdit[pid]
    if (e !== undefined) return e
    const u = byId(tabId)?.url ?? ''
    return isBlank(u) ? '' : u.replace(/^qa-source:/, 'view-source:')
  }
  function onUrlInput(pid: string, v: string): void {
    urlEdit[pid] = v
    sugIdx.value = -1
    clearTimeout(sugTimer)
    sugTimer = setTimeout(async () => {
      suggestions.value = v.trim() ? await window.qa.browser('suggest', v) : []
      suggestFor.value = suggestions.value.length ? pid : undefined
    }, 120)
  }
  /** The address line's keys: the arrows walk the suggestions (when there are any), Esc drops the edit, Enter goes. */
  const URL_KEYS: Record<string, (e: KeyboardEvent, pi: number) => void> = {
    ArrowDown: (e) => {
      if (!suggestions.value.length) return
      e.preventDefault()
      sugIdx.value = Math.min(suggestions.value.length - 1, sugIdx.value + 1)
    },
    ArrowUp: (e) => {
      if (!suggestions.value.length) return
      e.preventDefault()
      sugIdx.value = Math.max(-1, sugIdx.value - 1)
    },
    Escape: (_e, pi) => endUrl(bLayout.panes[pi].id, true),
    Enter: (e, pi) => {
      e.preventDefault()
      const pick = suggestions.value[sugIdx.value]
      // (the field's own text — what is seen is what goes, whatever happened to the edit's state)
      submitUrl(pi, pick ? pick.url : (e.target as HTMLInputElement).value)
    },
  }
  function onUrlKey(e: KeyboardEvent, pi: number): void {
    if (Object.hasOwn(URL_KEYS, e.key)) URL_KEYS[e.key](e, pi)
  }
  /** An address sent from a pane: what it was before — the site taking it back is told («перенаправление сайта»). */
  const sentUrl = reactive<Record<string, { want: string; was: string; at: number; left?: boolean } | undefined>>({})
  const bounced = reactive<Record<string, string | undefined>>({})
  function submitUrl(pi: number, text: string): void {
    const p = bLayout.panes[pi]
    endUrl(p.id, true)
    const url = toUrl(text)
    if (!p.active) return void deps.newTab(pi, url)
    const was = byId(p.active)?.url ?? ''
    bounced[p.id] = undefined
    // the very same address: the page loaded again (as Enter does in any browser)
    if (url === was) return void window.qa.browser('nav', p.active, 'reload')
    sentUrl[p.id] = { want: url, was, at: Date.now() }
    window.qa.browser('go', p.active, url)
  }
  /** Suggestions closed; the edit itself kept (focus going elsewhere does not lose what was typed — as in any browser). */
  function endSuggest(): void {
    suggestFor.value = undefined
    suggestions.value = []
  }
  function endUrl(pid: string, blur = false): void {
    urlEdit[pid] = undefined
    endSuggest()
    if (blur) urlEls.get(pid)?.blur()
  }
  // a pane's page went elsewhere (a link, the back button, another tab): a stale edit no more — the page's address shown;
  // an address sent and then taken back by the site within seconds — said
  watch(
    () => bLayout.panes.map((p) => [p.id, p.active, byId(p.active)?.url] as const),
    (now, before) => {
      for (const [pid, active, url] of now) {
        const old = before?.find((x) => x[0] === pid)
        if (old && (old[1] !== active || old[2] !== url) && document.activeElement !== urlEls.get(pid)) urlEdit[pid] = undefined
        const s = sentUrl[pid]
        if (!s || !url) continue
        if (Date.now() - s.at > 8000) sentUrl[pid] = undefined
        else if (url !== s.was) s.left = true
        else if (s.left || Date.now() - s.at > 1500) {
          bounced[pid] = `Сайт сам вернул прежний адрес — это перенаправление на стороне сайта (например, восстановил сохранённые фильтры): ${s.want}`
          sentUrl[pid] = undefined
          setTimeout(() => (bounced[pid] = undefined), 8000)
        }
      }
    },
  )
  // ---------- the address in parts (the arrow beside the address line) ----------
  const partsFor = ref<string>()
  function openFromParts(pi: number, url: string, newTabToo: boolean): void {
    partsFor.value = undefined
    if (newTabToo) void deps.newTab(pi, url)
    else submitUrl(pi, url)
  }
  async function focusUrl(pi: number): Promise<void> {
    await nextTick()
    const el = urlEls.get(bLayout.panes[pi]?.id ?? '')
    el?.focus()
    el?.select()
  }
  return { urlEdit, urlEls, urlwEls, suggestFor, suggestions, sugIdx, bounced, partsFor, urlShown, onUrlInput, onUrlKey, submitUrl, endSuggest, openFromParts, focusUrl }
}
