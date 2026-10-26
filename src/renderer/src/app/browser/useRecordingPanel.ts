import { computed, ref, watch, type Ref } from 'vue'
import { findLinks, recordingToHttp, type RecFull, type RecItem, type RecLink } from '@shared/browser'
import { recItems, recState } from '../../lib/browser'
import { firstRequestOf, importToHttp } from '../../lib/httpImport'

/**
 * The recording of the requests the pages send: on / off, the list (filtered, picked), one request's details under
 * it — and the picked ones carried to the HTTP section as a ready chain (its links: values from answers used later).
 */
export function useRecordingPanel(deps: { recOpen: Ref<boolean>; openHttp: (requestId: string) => void }) {
  const recError = ref('')
  function toggleRec(): void {
    recError.value = ''
    if (!recState.value.on) deps.recOpen.value = true
    void window.qa.browser('rec', !recState.value.on)
  }
  function setDocs(on: boolean): void {
    void window.qa.browser('rec', recState.value.on, on)
  }
  const recQ = ref('')
  const picked = ref(new Set<string>())
  const shownItems = computed(() => {
    const q = recQ.value.trim().toLowerCase()
    return q ? recItems.value.filter((x) => `${x.method} ${x.url} ${x.status ?? ''}`.toLowerCase().includes(q)) : recItems.value
  })
  watch(recItems, (l) => {
    // picks of items cleared away go too
    const ids = new Set(l.map((x) => x.id))
    for (const id of picked.value) if (!ids.has(id)) picked.value.delete(id)
  })
  function togglePick(id: string): void {
    const s = new Set(picked.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    picked.value = s
  }
  const allPicked = computed(() => shownItems.value.length > 0 && shownItems.value.every((x) => picked.value.has(x.id)))
  function pickAll(on: boolean): void {
    const s = new Set(picked.value)
    for (const x of shownItems.value) on ? s.add(x.id) : s.delete(x.id)
    picked.value = s
  }
  // a request's details under the list
  const focus = ref<RecFull>()
  const focusTab = ref<'req' | 'res'>('req')
  async function openItem(x: RecItem): Promise<void> {
    if (focus.value?.id === x.id) return void (focus.value = undefined)
    focus.value = (await window.qa.browser('recFull', [x.id]))[0]
  }
  function clearRec(): void {
    if (recItems.value.length && !confirm('Очистить записанные запросы?')) return
    picked.value = new Set()
    focus.value = undefined
    void window.qa.browser('recClear')
  }

  // ---------- the picked ones → the HTTP section ----------
  const transfer = ref<{ items: RecFull[]; links: RecLink[]; base: boolean; secrets: boolean }>()
  async function startTransfer(): Promise<void> {
    const ids = recItems.value.filter((x) => picked.value.has(x.id)).map((x) => x.id)
    if (ids.length) transferOf(await window.qa.browser('recFull', ids))
  }
  /** Requests from elsewhere (the API map's calls) → the same dialog: what they make, the variables, the links. */
  function transferOf(items: RecFull[]): void {
    if (items.length) transfer.value = { items, links: findLinks(items), base: true, secrets: true }
  }
  const transferPreview = computed(() => (transfer.value ? recordingToHttp(transfer.value.items, transfer.value.links, transfer.value) : undefined))
  async function doTransfer(): Promise<void> {
    const p = transferPreview.value
    if (!p) return
    transfer.value = undefined
    await importToHttp(p.folder, p.vars)
    deps.openHttp(firstRequestOf(p.folder))
  }
  return { recError, toggleRec, setDocs, recQ, picked, shownItems, togglePick, allPicked, pickAll, clearRec, focus, focusTab, openItem, transfer, startTransfer, transferOf, transferPreview, doTransfer }
}
