import { computed, ref, shallowRef, watch } from 'vue'
import { DEFAULT_BROWSER_SETTINGS, type BrowserSettings, type Visit } from '@shared/browser'
import { dayBounds, dayOf, findVisits, historyDays, plural } from '@shared/browser/historyDays'

/** The history's list grows by this many at a time. */
const PAGE = 300

/**
 * The history dialog: every page opening by days, searched by words, opened (Ctrl / the middle button — in a new
 * tab), forgotten one by one, by day or by period; the history on / off (the browser's settings).
 */
export function useBrowserHistory(deps: { openUrl: (url: string, inNew?: boolean) => void }) {
  const bSettings = ref<BrowserSettings>({ ...DEFAULT_BROWSER_SETTINGS })
  void window.qa.browser('settings').then((v) => (bSettings.value = v))
  const histOpen = ref(false)
  const visits = shallowRef<Visit[]>([])
  const histQ = ref('')
  const histLimit = ref(PAGE)
  async function loadHistory(): Promise<void> {
    visits.value = await window.qa.browser('visits')
  }
  function openHistory(): void {
    histQ.value = ''
    histLimit.value = PAGE
    histOpen.value = true
    void loadHistory()
  }
  watch(histQ, () => (histLimit.value = PAGE))
  const histFound = computed(() => findVisits(visits.value, histQ.value))
  const histDays = computed(() => historyDays(histFound.value, histLimit.value))
  function histGo(v: Visit, e: MouseEvent): void {
    const inNew = e.ctrlKey || e.metaKey || e.button === 1
    deps.openUrl(v.url, inNew)
    if (!inNew) histOpen.value = false
  }
  function histDel(ids: string[]): void {
    visits.value = visits.value.filter((v) => !ids.includes(v.id))
    void window.qa.browser('visitsDelete', ids)
  }
  function histDelDay(k: string, title: string): void {
    const n = visits.value.filter((v) => dayOf(v.at) === k).length
    const what = title === 'Сегодня' || title === 'Вчера' ? `историю за ${title.toLowerCase()}` : `историю за ${title}`
    if (!confirm(`Удалить ${what} — ${n} ${plural(n, 'страницу', 'страницы', 'страниц')}?`)) return
    visits.value = visits.value.filter((v) => dayOf(v.at) !== k)
    void window.qa.browser('visitsDelete', dayBounds(k))
  }
  async function histClear(e: MouseEvent): Promise<void> {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pick = await window.qa.browser('choose', [{ id: '#', label: 'Удалить из истории' }, { id: 'h', label: 'За последний час' }, { id: 'd', label: 'За сегодня' }, { id: 'w', label: 'За последние 7 дней' }, { id: '-', label: '' }, { id: 'all', label: 'Всю историю…' }], r.left, r.bottom + 2)
    if (!pick) return
    const now = Date.now()
    if (pick === 'all') {
      if (!confirm(`Удалить всю историю браузера (${visits.value.length})? Подсказки в строке адреса тоже забудутся.`)) return
      visits.value = []
      void window.qa.browser('clearHistory')
      return
    }
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const SINCE: Record<string, number> = { h: now - 3600e3, d: midnight.getTime(), w: now - 7 * 864e5 }
    const from = SINCE[pick] ?? SINCE.w
    visits.value = visits.value.filter((v) => v.at < from)
    void window.qa.browser('visitsDelete', { from, to: now + 60e3 })
  }
  async function setHistoryOn(on: boolean): Promise<void> {
    bSettings.value = await window.qa.browser('setSettings', { history: on })
  }
  return { bSettings, histOpen, visits, histQ, histLimit, loadHistory, openHistory, histFound, histDays, histGo, histDel, histDelDay, histClear, setHistoryOn }
}
