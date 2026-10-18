<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { readSpec, specToHttp, type ApiOp, type ApiSpec } from '@shared/openapi'
import { load as yamlLoad } from 'js-yaml'
import type { HttpNode } from '@shared/http'
import { browserId, deviceFit, DEVICES, findLinks, recordingToHttp, RESPONSIVE, toUrl, UA_MOBILE, type Bookmark, type BrowserSettings, type DeviceMode, type Visit, type CertInfo, type PasswordInfo, type RecFull, type RecItem, type RecLink } from '@shared/browser'
import { METHOD_COLOR } from '@shared/http'
import Icon from '../components/Icon.vue'
import ZoomChip from '../components/ZoomChip.vue'
import { bLayout, bookmarks, hostOf, moveTab, onBrowserEvent, placeTab, recItems, recState, splitWith, startBrowser, syncLayout, tabs, tabsLoaded, useOverlay } from '../lib/browser'

/**
 * Браузер: tabs in one or two panes (each pane its own tabs, like the terminal), the address line with
 * suggestions, bookmarks, a start page; the recording of the requests the pages send (XHR / fetch) — picked ones
 * go to the HTTP section as a ready chain. The pages themselves are native views the main process puts where
 * this section reports.
 */
const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ openHttp: [requestId: string] }>()
startBrowser()
const byId = (id?: string) => tabs.value.find((t) => t.id === id)
const isBlank = (url?: string) => !url || url === 'about:blank'

// ---------- tabs and panes ----------
let making = 0
watch([tabs, tabsLoaded], ([list, ok]) => ok && syncLayout(list, !making), { immediate: true })
const curId = computed(() => bLayout.panes[bLayout.cur]?.active)
async function newTab(pi = bLayout.cur, url?: string, after?: string): Promise<string> {
  making++
  try {
    const t = await window.qa.browser('create', url)
    placeTab(Math.min(pi, bLayout.panes.length - 1), t.id, after)
    if (!url) await focusUrl(Math.min(pi, bLayout.panes.length - 1))
    return t.id
  } finally {
    making--
  }
}
function closeTab(id: string): void {
  void window.qa.browser('close', id)
}
// no tab left (all closed) — a blank one
watch(
  () => tabsLoaded.value && !tabs.value.length && !making,
  (empty) => empty && restored && void newTab(0),
)
/** The open pages are remembered (their addresses by pane) and opened again on the next start. */
const SESSION = 'qa.browser.session'
let restored = false
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
onBrowserEvent((type, p) => {
  if (type === 'opened') {
    // a page opened one (target=_blank): next to it, in its pane
    const { id, opener } = p as { id: string; opener: string }
    const pi = paneOf(opener)
    placeTab(pi < 0 ? bLayout.cur : pi, id, opener)
  } else if (type === 'key') {
    const { id, key } = p as { id: string; key: string }
    const pi = Math.max(0, paneOf(id))
    if (key === 'newTab') void newTab(pi)
    else if (key === 'closeTab') closeTab(id)
    else if (key === 'focusUrl') void focusUrl(pi)
    else if (key === 'bookmark') toggleStar(id)
    else if (key === 'device') toggleDevice(id)
    else if (key === 'history') openHistory()
  } else if (type === 'open') {
    const { url, newTab: nt } = p as { url: string; newTab: boolean }
    openUrl(url, nt)
  } else if (type === 'login') login.value = { ...(p as { reqId: string; tabId: string; host: string; realm: string }), user: '', pass: '' }
  else if (type === 'download') download.value = p as { name: string; path: string; state: string }
  else if (type === 'recError') recError.value = String(p)
  else if (type === 'pwAsk') pwAsk.value = p as { askId: string; origin: string; username: string; update: boolean }
  else if (type === 'passwords') passwords.value = p as PasswordInfo[]
  else if (type === 'history') histOpen.value && void loadHistory()
  else if (type === 'settings') bSettings.value = p as BrowserSettings
})
/** A link from a bookmark / the start page: into the current tab (or a new one). */
function openUrl(url: string, inNew = false): void {
  const id = curId.value
  if (!id || inNew) void newTab(bLayout.cur, url)
  else window.qa.browser('go', id, url)
}
// keys of the section itself (the pages send theirs from the main process)
function onKey(e: KeyboardEvent): void {
  if (!props.active || !(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 't') (e.preventDefault(), void newTab())
  else if (k === 'w' && curId.value) (e.preventDefault(), closeTab(curId.value))
  else if (k === 'l') (e.preventDefault(), void focusUrl(bLayout.cur))
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ---------- the address line ----------
const urlEdit = reactive<Record<string, string | undefined>>({})
const urlEls = new Map<string, HTMLInputElement>()
const suggestFor = ref<string>()
const suggestions = ref<Array<{ url: string; title: string; bookmark: boolean }>>([])
const sugIdx = ref(-1)
let sugTimer: ReturnType<typeof setTimeout> | undefined
/** An address in parts for its colours: the scheme grey, the host bright, the path calm, the query in the accent. */
function urlParts(url: string): Array<{ t: string; c: string }> {
  const m = url.match(/^([a-z][\w+.-]*:(?:\/\/)?)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i)
  if (!m) return [{ t: url, c: 'u-path' }]
  const out: Array<{ t: string; c: string }> = [
    { t: m[1], c: 'u-scheme' },
    { t: m[2], c: 'u-host' },
    { t: m[3], c: 'u-path' },
  ]
  if (m[4]) {
    // ? key = value & …
    for (const part of m[4].split(/(?=[?&])/)) {
      const [k, ...v] = part.slice(1).split('=')
      out.push({ t: part[0], c: 'u-sep' }, { t: k, c: 'u-key' })
      if (v.length) out.push({ t: '=', c: 'u-sep' }, { t: v.join('='), c: 'u-val' })
    }
  }
  if (m[5]) out.push({ t: m[5], c: 'u-hash' })
  return out
}
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
function onUrlKey(e: KeyboardEvent, pi: number): void {
  const pid = bLayout.panes[pi].id
  if (e.key === 'ArrowDown' && suggestions.value.length) (e.preventDefault(), (sugIdx.value = Math.min(suggestions.value.length - 1, sugIdx.value + 1)))
  else if (e.key === 'ArrowUp' && suggestions.value.length) (e.preventDefault(), (sugIdx.value = Math.max(-1, sugIdx.value - 1)))
  else if (e.key === 'Escape') endUrl(pid, true)
  else if (e.key === 'Enter') {
    e.preventDefault()
    const pick = suggestions.value[sugIdx.value]
    submitUrl(pi, pick ? pick.url : (urlEdit[pid] ?? ''))
  }
}
function submitUrl(pi: number, text: string): void {
  const p = bLayout.panes[pi]
  endUrl(p.id, true)
  const url = toUrl(text)
  if (p.active) window.qa.browser('go', p.active, url)
  else void newTab(pi, url)
}
function endUrl(pid: string, blur = false): void {
  urlEdit[pid] = undefined
  suggestFor.value = undefined
  suggestions.value = []
  if (blur) urlEls.get(pid)?.blur()
}
async function focusUrl(pi: number): Promise<void> {
  await nextTick()
  const el = urlEls.get(bLayout.panes[pi]?.id ?? '')
  el?.focus()
  el?.select()
}

// (declared first: the watchers below read them at once)
const tabDrag = ref<{ pane: number; id: string; x: number; y: number }>()
const zone = ref<{ pane: number; side: 'left' | 'right' | 'here' }>()
const REC = 'qa.browser.rec'
const recSaved = (() => {
  try {
    return JSON.parse(localStorage.getItem(REC) ?? '{}') as { open?: boolean; w?: number }
  } catch {
    return {}
  }
})()
const recOpen = ref(recSaved.open ?? false)
const recW = ref(recSaved.w ?? 420)
watch([recOpen, recW], () => {
  try {
    localStorage.setItem(REC, JSON.stringify({ open: recOpen.value, w: recW.value }))
  } catch {
    // fine
  }
})
// ---------- the pages: where they go, when they make way ----------
const pageEls = new Map<string, HTMLElement>()
/** A pane shows its page (a tab with an address, opened fine); else the start page / the error. */
const pageShown = (id?: string) => {
  const t = byId(id)
  return !!t && !isBlank(t.url) && !t.error
}
const overlay = useOverlay()
const covering = computed(() => overlay.value || !!suggestFor.value || !!tabDrag.value)
const shots = ref<Record<string, string>>({})
let coverSeq = 0
watch(covering, async (on) => {
  const my = ++coverSeq
  const s = await window.qa.browser('cover', on)
  if (my !== coverSeq) return
  if (on) shots.value = s
  else requestAnimationFrame(() => (shots.value = {}))
})
let lastSent = ''
function sendLayout(): void {
  type B = { x: number; y: number; w: number; h: number }
  const rects: Array<B & { id: string; dev?: B; scale?: number }> = []
  const fits: Record<string, B & { scale: number }> = {}
  const box = (el: Element): B => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }
  if (props.active) {
    for (const p of bLayout.panes) {
      const el = pageEls.get(p.id)
      if (!el || !p.active || !pageShown(p.active)) continue
      const dv = devEls.get(p.id)
      const dev = dv && byId(p.active)?.devtools ? { dev: box(dv) } : {}
      const device = byId(p.active)?.device
      const area = areaEls.get(p.id)
      if (device && area) {
        // the device mode: the page as big as the device, made smaller to fit
        const a = box(area)
        const fit = deviceFit(device, a)
        fits[p.id] = { x: fit.x - a.x, y: fit.y - a.y, w: fit.w, h: fit.h, scale: fit.scale }
        rects.push({ id: p.active, x: fit.x, y: fit.y, w: fit.w, h: fit.h, scale: fit.scale, ...dev })
      } else rects.push({ id: p.active, ...box(el), ...dev })
    }
  }
  const fk = JSON.stringify(fits)
  if (fk !== JSON.stringify(devFits.value)) devFits.value = fits
  const key = JSON.stringify(rects.map((r) => [r.id, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), r.scale, r.dev && [Math.round(r.dev.x), Math.round(r.dev.y), Math.round(r.dev.w), Math.round(r.dev.h)]]))
  if (key === lastSent) return
  lastSent = key
  window.qa.browserLayout(rects)
}
let ro: ResizeObserver | undefined
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  ro = new ResizeObserver(() => requestAnimationFrame(sendLayout))
  window.addEventListener('resize', sendLayout)
  // the app's zoom / a panel moving do not always resize the page box itself
  tick = setInterval(sendLayout, 300)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  clearInterval(tick)
  window.removeEventListener('resize', sendLayout)
  window.qa.browserLayout([])
})
watch(
  () => [props.active, bLayout.panes.map((p) => `${p.id}:${p.active}`).join(), tabs.value.map((t) => `${t.id}${t.url}${t.error ? 'e' : ''}${t.devtools ? 'd' : ''}${t.device ? `${t.device.w}x${t.device.h}` : ''}`).join(), recOpen.value, recW.value, bLayout.split],
  () => nextTick(sendLayout),
)
/** The docked developer tools: their box under the page (its height dragged, remembered). */
const devEls = new Map<string, HTMLElement>()
function devRef(pid: string, el: unknown): void {
  if (el instanceof HTMLElement) devEls.set(pid, el)
  else devEls.delete(pid)
  void nextTick(sendLayout)
}
const devH = ref(Math.min(900, Math.max(120, Number(localStorage.getItem('qa.browser.devH')) || 320)))
const devW = ref(Math.min(1200, Math.max(240, Number(localStorage.getItem('qa.browser.devW')) || 480)))
/** Where the developer tools sit: under the page or at its right (remembered). */
const devSide = ref<'bottom' | 'right'>(localStorage.getItem('qa.browser.devSide') === 'right' ? 'right' : 'bottom')
watch(devSide, (v) => {
  try {
    localStorage.setItem('qa.browser.devSide', v)
  } catch {
    // fine
  }
  void nextTick(sendLayout)
})
function dragDev(e: PointerEvent): void {
  e.preventDefault()
  const x0 = e.clientX
  const y0 = e.clientY
  const h0 = devH.value
  const w0 = devW.value
  const right = devSide.value === 'right'
  const move = (ev: PointerEvent) => {
    if (right) devW.value = Math.min(window.innerWidth - 300, Math.max(240, w0 - (ev.clientX - x0)))
    else devH.value = Math.min(window.innerHeight - 220, Math.max(120, h0 - (ev.clientY - y0)))
    sendLayout()
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    try {
      localStorage.setItem('qa.browser.devH', String(devH.value))
      localStorage.setItem('qa.browser.devW', String(devW.value))
    } catch {
      // fine
    }
  }
  document.body.style.cursor = right ? 'col-resize' : 'row-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
// ---------- the device mode ----------
/** Each pane's device area (under its device bar) and where the device's page sits in it. */
const areaEls = new Map<string, HTMLElement>()
const devFits = shallowRef<Record<string, { x: number; y: number; w: number; h: number; scale: number }>>({})
function areaRef(pid: string, el: unknown): void {
  const prev = areaEls.get(pid)
  if (el === prev) return
  if (prev) ro?.unobserve(prev)
  if (el instanceof HTMLElement) {
    areaEls.set(pid, el)
    ro?.observe(el)
  } else areaEls.delete(pid)
  void nextTick(sendLayout)
}
const DEV_KEY = 'qa.browser.device'
function lastDevice(): DeviceMode {
  try {
    const d = JSON.parse(localStorage.getItem(DEV_KEY) ?? 'null') as DeviceMode | null
    if (d && d.w > 0 && d.h > 0) return d
  } catch {
    // none
  }
  return { ...RESPONSIVE }
}
function setDevice(id: string | undefined, d?: DeviceMode): void {
  if (!id) return
  if (d) {
    try {
      localStorage.setItem(DEV_KEY, JSON.stringify(d))
    } catch {
      // fine
    }
  }
  void window.qa.browser('device', id, d ? { ...d } : undefined)
}
function toggleDevice(id: string | undefined): void {
  const t = byId(id)
  if (!t || !pageShown(id)) return
  setDevice(id, t.device ? undefined : lastDevice())
}
/** A preset picked (its name), or «Адаптивный» — the sizes stay. */
function pickDevice(id: string | undefined, name: string): void {
  const cur = byId(id)?.device
  if (!cur) return
  const p = DEVICES.find((x) => x.name === name)
  setDevice(id, p ? { ...p } : { ...RESPONSIVE, w: cur.w, h: cur.h })
}
/** The sizes typed: a device of one's own (as Chrome's «Адаптивный»). */
function sizeDevice(id: string | undefined, w: number, h: number): void {
  const cur = byId(id)?.device
  if (!cur || !(w >= 50 && h >= 50)) return
  setDevice(id, { ...cur, name: '', w: Math.min(4000, Math.round(w)), h: Math.min(4000, Math.round(h)) })
}
function patchDevice(id: string | undefined, patch: Partial<DeviceMode>): void {
  const cur = byId(id)?.device
  if (!cur) return
  const next = { ...cur, ...patch }
  // a preset changed by hand is one's own
  if (patch.mobile !== undefined || patch.dpr !== undefined) next.name = ''
  if (patch.mobile !== undefined) next.ua = patch.mobile ? cur.ua || UA_MOBILE : undefined
  setDevice(id, next)
}
const rotateDevice = (id: string | undefined) => {
  const cur = byId(id)?.device
  if (cur) setDevice(id, { ...cur, w: cur.h, h: cur.w })
}
const DPRS = [1, 1.25, 1.5, 2, 2.625, 3, 3.5, 4]
const dprList = (d: DeviceMode) => (DPRS.includes(d.dpr) ? DPRS : [...DPRS, d.dpr].sort((a, b) => a - b))
const devGroups = [
  { label: 'Телефоны', list: DEVICES.filter((d) => d.mobile && d.w < 600) },
  { label: 'Планшеты', list: DEVICES.filter((d) => d.mobile && d.w >= 600) },
  { label: 'Компьютеры', list: DEVICES.filter((d) => !d.mobile) },
]
const numIn = (e: Event) => Number((e.target as HTMLInputElement).value)
const below = (e: MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect()
async function deviceMenu(id: string | undefined, e: MouseEvent): Promise<void> {
  const cur = byId(id)?.device
  if (!cur) return
  const r = below(e)
  const items = [
    { id: '', label: 'Адаптивный — свои размеры', checked: !cur.name },
    ...devGroups.flatMap((g) => [{ id: '-', label: '' }, { id: `#${g.label}`, label: g.label }, ...g.list.map((d) => ({ id: d.name, label: `${d.name}    ${d.w} × ${d.h}`, checked: cur.name === d.name }))]),
  ]
  const pick = await window.qa.browser('choose', items, r.left, r.bottom + 2)
  if (pick !== undefined) pickDevice(id, pick)
}
async function dprMenu(id: string | undefined, e: MouseEvent): Promise<void> {
  const cur = byId(id)?.device
  if (!cur) return
  const r = below(e)
  const pick = await window.qa.browser('choose', [{ id: '#', label: 'Плотность пикселей (DPR)' }, ...dprList(cur).map((v) => ({ id: String(v), label: String(v), checked: v === cur.dpr }))], r.left, r.bottom + 2)
  if (pick) patchDevice(id, { dpr: Number(pick) })
}

function pageRef(pid: string, el: unknown): void {
  const prev = pageEls.get(pid)
  if (el === prev) return
  if (prev) ro?.unobserve(prev)
  if (el instanceof HTMLElement) {
    pageEls.set(pid, el)
    ro?.observe(el)
  } else pageEls.delete(pid)
}

// the split's width
const panesEl = ref<HTMLElement>()
function onSplitResize(e: PointerEvent): void {
  const x0 = e.clientX
  const s0 = bLayout.split
  const w = panesEl.value?.clientWidth ?? 1000
  const move = (ev: PointerEvent) => (bLayout.split = Math.min(0.8, Math.max(0.2, s0 + (ev.clientX - x0) / w)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// tabs dragged with the pointer: along a row — the order; onto the other pane's row — moved; a page's edge — split
let dragged = false
function onTabDown(e: PointerEvent, pi: number, id: string): void {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
  const x0 = e.clientX
  const y0 = e.clientY
  let from = pi
  const move = (ev: PointerEvent) => {
    if (!tabDrag.value) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      tabDrag.value = { pane: from, id, x: ev.clientX, y: ev.clientY }
      document.body.style.cursor = 'grabbing'
    }
    tabDrag.value.x = ev.clientX
    tabDrag.value.y = ev.clientY
    from = dragOver(from, id, ev.clientX, ev.clientY)
    tabDrag.value.pane = from
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    document.body.style.cursor = ''
    if (!tabDrag.value) return
    dragged = true
    setTimeout(() => (dragged = false))
    const z = zone.value
    tabDrag.value = undefined
    zone.value = undefined
    if (!z) return
    if (z.side === 'here') moveTab(from, id, z.pane, bLayout.panes[z.pane].tabs.length)
    else splitWith(from, id, z.side)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
function dragOver(from: number, id: string, x: number, y: number): number {
  zone.value = undefined
  const panes = [...(panesEl.value?.querySelectorAll<HTMLElement>(':scope > .pane') ?? [])]
  const pi = panes.findIndex((el) => {
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  })
  if (pi < 0) return from
  const el = panes[pi]
  const bar = el.querySelector<HTMLElement>('.tbar')!.getBoundingClientRect()
  if (y <= bar.bottom) {
    const list = el.querySelector<HTMLElement>('.tlist')
    if (!list) return from
    const box = list.getBoundingClientRect()
    const k = list.offsetWidth ? box.width / list.offsetWidth : 1
    const lx = (x - box.left) / k
    const others = bLayout.panes[pi].tabs.filter((t) => t !== id)
    const at = [...list.querySelectorAll<HTMLElement>('.tab')].filter((t) => t.dataset.id !== id && others.includes(t.dataset.id!)).filter((t) => t.offsetLeft + t.offsetWidth / 2 < lx).length
    if (pi === from) {
      if (bLayout.panes[pi].tabs.indexOf(id) !== at) bLayout.panes[pi].tabs = [...others.slice(0, at), id, ...others.slice(at)]
      return from
    }
    const before = bLayout.panes.length
    moveTab(from, id, pi, at)
    return bLayout.panes.length < before && from < pi ? pi - 1 : pi
  }
  if (bLayout.panes.length === 1) {
    if (bLayout.panes[0].tabs.length < 2) return from
    const r = el.getBoundingClientRect()
    if (x < r.left + r.width * 0.3) zone.value = { pane: pi, side: 'left' }
    else if (x > r.right - r.width * 0.3) zone.value = { pane: pi, side: 'right' }
  } else if (pi !== from) zone.value = { pane: pi, side: 'here' }
  return from
}
function onTabClick(pi: number, id: string): void {
  if (!dragged) show(pi, id)
}

// ---------- bookmarks ----------
const findBm = (pred: (b: Bookmark) => boolean, list = bookmarks.value): Bookmark | undefined => {
  for (const b of list) {
    if (pred(b)) return b
    const f = b.children && findBm(pred, b.children)
    if (f) return f
  }
  return undefined
}
const starred = (id?: string) => {
  const u = byId(id)?.url
  return !!u && !isBlank(u) && !!findBm((b) => b.url === u)
}
const saveBms = (list: Bookmark[]) => void window.qa.browser('setBookmarks', JSON.parse(JSON.stringify(list)) as Bookmark[])
const without = (list: Bookmark[], pred: (b: Bookmark) => boolean): Bookmark[] => list.filter((b) => !pred(b)).map((b) => (b.children ? { ...b, children: without(b.children, pred) } : b))
/** A tree with `item` put into a folder (none — the bar) at a place (none — the end). */
function insertInto(list: Bookmark[], folder: string | undefined, item: Bookmark, at?: number): Bookmark[] {
  const put = (l: Bookmark[]) => {
    const c = [...l]
    c.splice(at === undefined ? c.length : Math.min(at, c.length), 0, item)
    return c
  }
  if (!folder) return put(list)
  return list.map((b) => (b.id === folder ? { ...b, children: put(b.children ?? []) } : b.children ? { ...b, children: insertInto(b.children, folder, item, at) } : b))
}
/** Bookmark icons that would not load (a globe instead). */
const badIcon = reactive(new Set<string>())
const folderCount = computed(() => {
  let n = 0
  const walk = (l: Bookmark[]) => l.forEach((b) => b.children && (n++, walk(b.children)))
  walk(bookmarks.value)
  return n
})
/** The star: off — removed; on — with folders, asked where to (and its name); else straight to the bar. */
function toggleStar(id?: string): void {
  const t = byId(id)
  if (!t || isBlank(t.url)) return
  if (findBm((b) => b.url === t.url)) return saveBms(without(bookmarks.value, (b) => b.url === t.url))
  const title = t.title || hostOf(t.url)
  if (folderCount.value) bmEdit.value = { id: '', title, url: t.url, folder: '', isFolder: false, icon: t.favicon }
  else saveBms([...bookmarks.value, { id: browserId(), title, url: t.url, ...(t.favicon ? { icon: t.favicon } : {}) }])
}
// a bookmark without its icon gets it when its page shows one
watch(tabs, (list) => {
  let changed = false
  const fill = (l: Bookmark[]): Bookmark[] =>
    l.map((b) => {
      if (b.children) return { ...b, children: fill(b.children) }
      const t = !b.icon && b.url ? list.find((x) => x.url === b.url && x.favicon) : undefined
      if (!t) return b
      changed = true
      return { ...b, icon: t.favicon }
    })
  const next = fill(bookmarks.value)
  if (changed) saveBms(next)
})
function openBm(b: Bookmark, e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement | null
  // a folder in a folder's list opens in that list; on the bar — under its chip
  if (b.children) openFolder(b.id, el?.classList?.contains('bmrow') ? undefined : (el ?? undefined), !!el?.classList?.contains('bmrow'))
  else if (b.url) {
    folderPop.value = undefined
    openUrl(b.url, e.ctrlKey || e.metaKey || e.button === 1)
  }
}
async function onBmMenu(b: Bookmark | undefined, e: MouseEvent): Promise<void> {
  const items = b
    ? [...(b.url ? [{ id: 'new', label: 'Открыть в новой вкладке' }, { id: '-', label: '' }] : []), { id: 'edit', label: b.children ? 'Переименовать…' : 'Изменить…' }, { id: 'del', label: b.children ? 'Удалить папку' : 'Удалить' }, { id: '-', label: '' }, { id: 'folder', label: 'Новая папка…' }]
    : [{ id: 'folder', label: 'Новая папка…' }]
  const pick = await window.qa.browser('choose', items, e.clientX, e.clientY)
  if (pick === 'new' && b?.url) openUrl(b.url, true)
  else if (pick === 'edit' && b) bmEdit.value = { id: b.id, title: b.title, url: b.url ?? '', folder: parentOf(b.id)?.id ?? '', isFolder: !!b.children, icon: b.icon }
  else if (pick === 'del' && b && (!b.children?.length || confirm(`Удалить папку «${b.title}» со всем, что в ней?`))) saveBms(without(bookmarks.value, (x) => x.id === b.id))
  else if (pick === 'folder') bmEdit.value = { id: '', title: 'Новая папка', url: '', folder: folderPop.value?.id ?? '', isFolder: true }
}
const parentOf = (id: string, list = bookmarks.value, parent?: Bookmark): Bookmark | undefined => {
  for (const b of list) {
    if (b.id === id) return parent
    const f = b.children && parentOf(id, b.children, b)
    if (f) return f
  }
  return undefined
}
const folders = computed(() => {
  const out: Array<{ id: string; title: string }> = []
  const walk = (list: Bookmark[], depth: number) => {
    for (const b of list)
      if (b.children) {
        out.push({ id: b.id, title: `${'  '.repeat(depth)}${b.title}` })
        walk(b.children, depth + 1)
      }
  }
  walk(bookmarks.value, 0)
  return out
})
const bmEdit = ref<{ id: string; title: string; url: string; folder: string; isFolder: boolean; icon?: string }>()
function saveBmEdit(): void {
  const e = bmEdit.value
  if (!e) return
  bmEdit.value = undefined
  const old = e.id ? findBm((b) => b.id === e.id) : undefined
  const item: Bookmark = e.isFolder
    ? { id: e.id || browserId(), title: e.title.trim() || 'Папка', children: old?.children ?? [] }
    : { id: e.id || browserId(), title: e.title.trim() || hostOf(e.url), url: toUrl(e.url), ...(e.icon ? { icon: e.icon } : {}) }
  const list = e.id ? without(bookmarks.value, (b) => b.id === e.id) : [...bookmarks.value]
  // (a folder never into itself)
  saveBms(insertInto(list, e.folder && e.folder !== item.id ? e.folder : undefined, item))
}

// a folder's contents: a list under its chip (going deeper inside it, back with ‹)
const folderPop = ref<{ id: string; x: number; y: number; trail: string[] }>()
function openFolder(id: string, anchor?: HTMLElement, deeper = false): void {
  if (!deeper && folderPop.value?.id === id && !bmDrag.value) return void (folderPop.value = undefined)
  const r = anchor?.getBoundingClientRect()
  const p = folderPop.value
  folderPop.value = deeper && p ? { ...p, id, trail: [...p.trail, p.id] } : { id, x: r?.left ?? p?.x ?? 0, y: (r?.bottom ?? (p ? p.y - 4 : 0)) + 4, trail: [] }
}
function folderBack(): void {
  const p = folderPop.value
  if (p?.trail.length) folderPop.value = { ...p, id: p.trail[p.trail.length - 1], trail: p.trail.slice(0, -1) }
}
const popFolder = computed(() => (folderPop.value ? findBm((b) => b.id === folderPop.value!.id) : undefined))
const popEl = ref<HTMLElement>()
function onPopDown(e: PointerEvent): void {
  const t = e.target as Node
  if (folderPop.value && !popEl.value?.contains(t) && !(t as HTMLElement).closest?.('.bm.folder')) folderPop.value = undefined
}
onMounted(() => document.addEventListener('pointerdown', onPopDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPopDown, true))

/**
 * Bookmarks dragged with the pointer: along the bar or a folder's list — their place; onto a folder (its middle) —
 * into it; out of a folder's list onto the bar — out of it. Held over a folder for a moment, it opens.
 */
const bmDrag = ref<string>()
const bmGhost = ref<{ x: number; y: number; title: string }>()
type BmDrop = { into: string } | { folder?: string; at: number; mark: string; side: 'before' | 'after' }
const bmDrop = ref<BmDrop>()
function onBmDown(e: PointerEvent, b: Bookmark): void {
  if (e.button !== 0) return
  const x0 = e.clientX
  const y0 = e.clientY
  const el = e.currentTarget as HTMLElement
  let moved = false
  let hoverFolder = ''
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
    moved = true
    bmDrag.value = b.id
    bmGhost.value = { x: ev.clientX, y: ev.clientY, title: b.title }
    bmDrop.value = dropAt(ev.clientX, ev.clientY, b)
    // held over a folder: it opens (to drop at a place inside)
    const into = bmDrop.value && 'into' in bmDrop.value ? bmDrop.value.into : ''
    if (into !== hoverFolder) {
      hoverFolder = into
      clearTimeout(hoverTimer)
      if (into) {
        hoverTimer = setTimeout(() => {
          const chip = document.querySelector<HTMLElement>(`[data-bm="${into}"]`)
          if (chip?.classList.contains('bmrow')) openFolder(into, undefined, true)
          else openFolder(into, chip ?? undefined)
        }, 700)
      }
    }
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    clearTimeout(hoverTimer)
    const d = bmDrop.value
    bmDrag.value = undefined
    bmGhost.value = undefined
    bmDrop.value = undefined
    if (!moved) return openBm(b, { ...ev, currentTarget: el, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, button: ev.button } as unknown as MouseEvent)
    if (d) moveBm(b, d)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
/** What is under the pointer: a folder to go into, or a place in the bar / a folder's list. */
function dropAt(x: number, y: number, b: Bookmark): BmDrop | undefined {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const target = el?.closest<HTMLElement>('[data-bm]')
  const inside = (folderId: string) => !!b.children && (folderId === b.id || !!findBm((x) => x.id === folderId, b.children))
  if (target) {
    const id = target.dataset.bm!
    if (id === b.id) return undefined
    const t = findBm((x) => x.id === id)
    const r = target.getBoundingClientRect()
    const row = target.classList.contains('bmrow')
    // along: the bar runs left-right, a list top-down
    const pos = row ? (y - r.top) / r.height : (x - r.left) / r.width
    if (t?.children && pos > 0.25 && pos < 0.75 && !inside(id)) return { into: id }
    const parent = parentOf(id)?.id
    if (parent && inside(parent)) return undefined
    const sibs = parent ? (findBm((x) => x.id === parent)?.children ?? []) : bookmarks.value
    const idx = sibs.findIndex((x) => x.id === id)
    return { folder: parent, at: pos < 0.5 ? idx : idx + 1, mark: id, side: pos < 0.5 ? 'before' : 'after' }
  }
  if (el?.closest('.bbar')) return { at: bookmarks.value.length, mark: '', side: 'after' }
  if (el?.closest('.bmpop') && folderPop.value && !inside(folderPop.value.id)) return { folder: folderPop.value.id, at: popFolder.value?.children?.length ?? 0, mark: '', side: 'after' }
  return undefined
}
function moveBm(b: Bookmark, d: BmDrop): void {
  const from = parentOf(b.id)?.id
  const sibs = from ? (findBm((x) => x.id === from)?.children ?? []) : bookmarks.value
  const was = sibs.findIndex((x) => x.id === b.id)
  const list = without(bookmarks.value, (x) => x.id === b.id)
  if ('into' in d) return saveBms(insertInto(list, d.into, b))
  // the same list: its own place left it, the ones after it moved up by one
  const at = d.folder === from && was >= 0 && was < d.at ? d.at - 1 : d.at
  saveBms(insertInto(list, d.folder, b, at))
}
const dropCls = (id: string) => {
  const d = bmDrop.value
  if (!d) return ''
  if ('into' in d) return d.into === id ? 'dropin' : ''
  return d.mark === id ? `drop-${d.side}` : ''
}
/** The start page: bookmarks and the most visited. */
const popular = ref<Array<{ url: string; title: string }>>([])
watch(
  () => [props.active, tabs.value.some((t) => isBlank(t.url))],
  async () => (popular.value = (await window.qa.browser('suggest', '')).filter((x) => !x.bookmark).slice(0, 12)),
  { immediate: true },
)
const flatBms = computed(() => {
  const out: Bookmark[] = []
  const walk = (l: Bookmark[]) => l.forEach((b) => (b.url ? out.push(b) : b.children && walk(b.children)))
  walk(bookmarks.value)
  return out.slice(0, 24)
})

// ---------- sign-in, downloads ----------
const login = ref<{ reqId: string; tabId: string; host: string; realm: string; user: string; pass: string }>()
function loginDone(ok: boolean): void {
  const l = login.value
  login.value = undefined
  if (l) window.qa.browser('loginReply', l.reqId, ok ? l.user : undefined, ok ? l.pass : undefined)
}
const download = ref<{ name: string; path: string; state: string }>()

// ---------- the recording ----------
const recError = ref('')
function toggleRec(): void {
  recError.value = ''
  if (!recState.value.on) recOpen.value = true
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
function clearRec(): void {
  if (recItems.value.length && !confirm('Очистить записанные запросы?')) return
  picked.value = new Set()
  focus.value = undefined
  void window.qa.browser('recClear')
}
const pathOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}
const statusCls = (s?: number) => (!s ? '' : s >= 500 ? 'e5' : s >= 400 ? 'e4' : s >= 300 ? 's3' : 's2')
const mColor = (m: string) => METHOD_COLOR[m as keyof typeof METHOD_COLOR] ?? 'var(--muted)'
const hms = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
// a request's details under the list
const focus = ref<RecFull>()
const focusTab = ref<'req' | 'res'>('req')
async function openItem(x: RecItem): Promise<void> {
  if (focus.value?.id === x.id) return void (focus.value = undefined)
  focus.value = (await window.qa.browser('recFull', [x.id]))[0]
}
const pretty = (s?: string) => {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
function dragRec(e: PointerEvent): void {
  e.preventDefault()
  const x0 = e.clientX
  const w0 = recW.value
  const move = (ev: PointerEvent) => (recW.value = Math.min(900, Math.max(300, w0 - (ev.clientX - x0))))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// the picked ones → the HTTP section
const transfer = ref<{ items: RecFull[]; links: RecLink[]; base: boolean; secrets: boolean }>()
async function startTransfer(): Promise<void> {
  const ids = recItems.value.filter((x) => picked.value.has(x.id)).map((x) => x.id)
  if (!ids.length) return
  const items = await window.qa.browser('recFull', ids)
  transfer.value = { items, links: findLinks(items), base: true, secrets: true }
}
const transferPreview = computed(() => (transfer.value ? recordingToHttp(transfer.value.items, transfer.value.links, transfer.value) : undefined))
async function doTransfer(): Promise<void> {
  const p = transferPreview.value
  if (!p) return
  transfer.value = undefined
  await window.qa.httpImport(JSON.parse(JSON.stringify(p.folder)), JSON.parse(JSON.stringify(p.vars)))
  emit('openHttp', p.folder.children[0]?.id ?? p.folder.id)
}
const useText = (l: RecLink) => l.uses.map((u) => `№${u.to + 1} ${u.where === 'path' ? 'путь' : u.where === 'query' ? `параметр ${u.key}` : u.where === 'body' ? `тело ${u.key}` : `заголовок ${u.key}`}`).join(', ')
// ---------- Swagger / OpenAPI ----------
const panelMode = ref<'rec' | 'api'>('rec')
const api = shallowRef<{ url: string; spec: unknown; info: ApiSpec; origin: string }>()
const apiBusy = ref(false)
const apiError = ref('')
const apiTried = ref<string[]>([])
const apiQ = ref('')
const apiPicked = ref(new Set<string>())
/** The panel on Swagger; `look` — search right away when this site has not been searched yet. */
function openSwagger(look: boolean): void {
  recOpen.value = true
  panelMode.value = 'api'
  const origin = originOf(byId(curId.value)?.url)
  if (look && !apiBusy.value && api.value?.origin !== origin && pageShown(curId.value)) void findSwagger()
}
async function findSwagger(): Promise<void> {
  const id = curId.value
  if (!id) return
  apiBusy.value = true
  // a new search (this site or another) starts from an empty list
  clearApi()
  try {
    const r = await window.qa.browser('swaggerFind', id)
    if ('error' in r) {
      apiError.value = r.error
      apiTried.value = r.tried
      return
    }
    let spec: unknown
    try {
      spec = JSON.parse(r.text)
    } catch {
      spec = yamlLoad(r.text)
    }
    api.value = { url: r.url, spec, info: readSpec(spec), origin: originOf(byId(id)?.url) }
    apiPicked.value = new Set()
  } catch (e) {
    apiError.value = e instanceof Error ? e.message : String(e)
  } finally {
    apiBusy.value = false
  }
}
function clearApi(): void {
  api.value = undefined
  apiError.value = ''
  apiTried.value = []
  apiPicked.value = new Set()
  apiQ.value = ''
}
const apiShown = computed(() => {
  const q = apiQ.value.trim().toLowerCase()
  const ops = api.value?.info.ops ?? []
  return q ? ops.filter((o) => `${o.method} ${o.path} ${o.summary} ${o.tag} ${o.operationId ?? ''}`.toLowerCase().includes(q)) : ops
})
const apiGroups = computed(() => {
  const m = new Map<string, ApiOp[]>()
  for (const o of apiShown.value) m.set(o.tag, [...(m.get(o.tag) ?? []), o])
  return [...m].map(([tag, ops]) => ({ tag, ops }))
})
const apiAll = computed(() => apiShown.value.length > 0 && apiShown.value.every((o) => apiPicked.value.has(o.id)))
function apiToggle(id: string): void {
  const s = new Set(apiPicked.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  apiPicked.value = s
}
function apiPickGroup(ops: ApiOp[], on: boolean): void {
  const s = new Set(apiPicked.value)
  for (const o of ops) on ? s.add(o.id) : s.delete(o.id)
  apiPicked.value = s
}
const apiPickAll = (on: boolean) => apiPickGroup(apiShown.value, on)
const API_OPTS = 'qa.browser.apiOpts'
const apiOpts = ref<{ defaults: boolean; optional: boolean }>((() => {
  try {
    return { defaults: true, optional: false, ...(JSON.parse(localStorage.getItem(API_OPTS) ?? '{}') as object) }
  } catch {
    return { defaults: true, optional: false }
  }
})())
watch(apiOpts, (v) => {
  try {
    localStorage.setItem(API_OPTS, JSON.stringify(v))
  } catch {
    // fine
  }
}, { deep: true })
const apiAsk = ref(false)
async function apiToHttp(): Promise<void> {
  const a = api.value
  apiAsk.value = false
  if (!a) return
  try {
    const { folder, vars } = specToHttp(a.spec, a.url, a.info.ops.filter((o) => apiPicked.value.has(o.id)).map((o) => o.id), apiOpts.value)
    await window.qa.httpImport(JSON.parse(JSON.stringify(folder)), JSON.parse(JSON.stringify(vars)))
    const first = (n: HttpNode): string | undefined => (n.type === 'request' ? n.id : n.children.map(first).find(Boolean))
    emit('openHttp', first(folder) ?? folder.id)
  } catch (e) {
    apiError.value = e instanceof Error ? e.message : String(e)
  }
}

// ---------- the rulers ----------
function toggleRuler(id: string): void {
  void window.qa.browser('ruler', id, !byId(id)?.ruler)
}
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
    if (path) void newTab(bLayout.cur, `file:///${encodeURI(path.replace(/\\/g, '/'))}`)
  }
  for (const u of links) void newTab(bLayout.cur, u)
}

// ---------- the site's connection (the icon before the address) ----------
const cert = ref<{ info: CertInfo; x: number; y: number }>()
const certEl = ref<HTMLElement>()
async function showCert(id: string, e: MouseEvent): Promise<void> {
  if (cert.value) return void (cert.value = undefined)
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const info = await window.qa.browser('certInfo', id)
  if (info) cert.value = { info, x: r.left, y: r.bottom + 6 }
}
const certCls = (id?: string) => {
  const u = byId(id)?.url ?? ''
  return u.startsWith('https:') ? 'sec' : u.startsWith('http:') ? 'insec' : ''
}
const longDate = (t?: number) => (t ? new Date(t).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
function onCertDown(e: PointerEvent): void {
  const t = e.target as HTMLElement
  if (cert.value && !certEl.value?.contains(t) && !t.closest?.('.certb')) cert.value = undefined
}
onMounted(() => document.addEventListener('pointerdown', onCertDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onCertDown, true))
function resetSite(id: string): void {
  const host = hostOf(byId(id)?.url ?? '')
  if (confirm(`Сбросить всё, что сайт ${host} сохранил в этом браузере — кэш, куки (вход на сайт), localStorage, IndexedDB, service workers — и перезагрузить страницу?`)) void window.qa.browser('resetSite', id)
}

// ---------- the history ----------
const bSettings = ref<BrowserSettings>({ history: true, ua: '' })
void window.qa.browser('settings').then((v) => (bSettings.value = v))
const histOpen = ref(false)
const visits = shallowRef<Visit[]>([])
const histQ = ref('')
const histLimit = ref(300)
async function loadHistory(): Promise<void> {
  visits.value = await window.qa.browser('visits')
}
function openHistory(): void {
  histQ.value = ''
  histLimit.value = 300
  histOpen.value = true
  void loadHistory()
}
watch(histQ, () => (histLimit.value = 300))
const histFound = computed(() => {
  const words = histQ.value.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return visits.value
  return visits.value.filter((v) => {
    const s = `${v.title} ${v.url}`.toLowerCase()
    return words.every((w) => s.includes(w))
  })
})
const dayOf = (t: number) => new Date(t).toLocaleDateString('sv-SE')
function dayTitle(k: string): string {
  const today = dayOf(Date.now())
  if (k === today) return 'Сегодня'
  if (k === dayOf(Date.now() - 864e5)) return 'Вчера'
  return new Date(`${k}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: k.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })
}
const histDays = computed(() => {
  const out: Array<{ k: string; title: string; items: Visit[]; total: number }> = []
  const totals = new Map<string, number>()
  for (const v of histFound.value) totals.set(dayOf(v.at), (totals.get(dayOf(v.at)) ?? 0) + 1)
  for (const v of histFound.value.slice(0, histLimit.value)) {
    const k = dayOf(v.at)
    let d = out[out.length - 1]
    if (!d || d.k !== k) out.push((d = { k, title: dayTitle(k), items: [], total: totals.get(k) ?? 0 }))
    d.items.push(v)
  }
  return out
})
const hhmm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
function histGo(v: Visit, e: MouseEvent): void {
  const inNew = e.ctrlKey || e.metaKey || e.button === 1
  openUrl(v.url, inNew)
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
  const from = new Date(`${k}T00:00:00`)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  visits.value = visits.value.filter((v) => dayOf(v.at) !== k)
  void window.qa.browser('visitsDelete', { from: from.getTime(), to: to.getTime() })
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
  const from = pick === 'h' ? now - 3600e3 : pick === 'd' ? midnight.getTime() : now - 7 * 864e5
  visits.value = visits.value.filter((v) => v.at < from)
  void window.qa.browser('visitsDelete', { from, to: now + 60e3 })
}
async function setHistoryOn(on: boolean): Promise<void> {
  bSettings.value = await window.qa.browser('setSettings', { history: on })
}
function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10
  const b = n % 100
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many
}

// ---------- passwords ----------
const passwords = ref<PasswordInfo[]>([])
void window.qa.browser('passwords').then((l) => (passwords.value = l))
const pwAsk = ref<{ askId: string; origin: string; username: string; update: boolean }>()
function pwReply(a: 'save' | 'no' | 'never'): void {
  const x = pwAsk.value
  pwAsk.value = undefined
  if (x) void window.qa.browser('pwAnswer', x.askId, a)
}
const originOf = (url?: string) => {
  try {
    return new URL(url ?? '').origin
  } catch {
    return ''
  }
}
const sitePasswords = (id?: string) => {
  const o = originOf(byId(id)?.url)
  return o ? passwords.value.filter((x) => x.origin === o) : []
}
/** The passwords list: '' — all, an origin — that site's. */
const pwOpen = ref<string>()
const pwQ = ref('')
const pwShown = reactive<Record<string, string>>({})
const pwList = computed(() => {
  const q = pwQ.value.trim().toLowerCase()
  return passwords.value.filter((x) => (!pwOpen.value || x.origin === pwOpen.value) && (!q || `${x.origin} ${x.username}`.toLowerCase().includes(q))).sort((a, b) => a.origin.localeCompare(b.origin))
})
const never = ref<string[]>([])
watch(pwOpen, async (o) => o !== undefined && (never.value = await window.qa.browser('neverList')))
async function pwToggle(id: string): Promise<void> {
  if (pwShown[id] !== undefined) delete pwShown[id]
  else pwShown[id] = await window.qa.browser('pwReveal', id)
}
async function pwCopy(id: string): Promise<void> {
  await navigator.clipboard.writeText(await window.qa.browser('pwReveal', id))
}
function pwDel(x: PasswordInfo): void {
  if (confirm(`Удалить сохранённый пароль ${x.username || '(без логина)'} для ${hostOf(x.origin)}?`)) void window.qa.browser('pwDelete', x.id)
}
function pwFill(x: PasswordInfo): void {
  const id = curId.value
  if (!id) return
  pwOpen.value = undefined
  void window.qa.browser('pwFill', id, x.id)
}
const window_nav = (id: string, a: 'back' | 'fwd' | 'reload' | 'stop' | 'devtools') => void window.qa.browser('nav', id, a)
const window_zoom = (id: string, z: number) => void window.qa.browser('zoom', id, z)
const window_trust = (id: string, host: string) => void window.qa.browser('trust', id, host)
const window_show = (path: string) => void window.qa.browser('reveal', path)
const window_never = (origin: string) => void window.qa.browser('neverRemove', origin)
const setTimeout_ = (f: () => void, ms: number) => void setTimeout(f, ms)
/** «{{base_…}}» as text (a mustache inside a mustache would close it). */
const BASE_VAR = '{{base_…}}'
</script>

<template>
  <div class="bv" :style="{ gridTemplateColumns: recOpen ? `minmax(0, 1fr) ${recW}px` : 'minmax(0, 1fr)' }" @dragover="onDragOver" @drop="onDrop">
    <section class="bmain">
      <!-- bookmarks, the recording -->
      <div class="bbar" @contextmenu.self.prevent="onBmMenu(undefined, $event)">
        <button
          v-for="b in bookmarks"
          :key="b.id"
          class="bm"
          :class="[{ folder: !!b.children, dragging: bmDrag === b.id, open: folderPop?.id === b.id && !folderPop.trail.length }, dropCls(b.id)]"
          :data-bm="b.id"
          :title="b.url ?? b.title"
          @pointerdown="onBmDown($event, b)"
          @auxclick.prevent="$event.button === 1 && b.url && openUrl(b.url, true)"
          @contextmenu.prevent="onBmMenu(b, $event)"
        >
          <Icon v-if="b.children" name="folder" :size="12" class="bfi" /><img v-else-if="b.icon && !badIcon.has(b.id)" class="bico" :src="b.icon" alt="" @error="badIcon.add(b.id)" /><Icon v-else name="globe" :size="12" class="bfi0" /><span>{{ b.title }}</span><Icon v-if="b.children" name="chevronDown" :size="10" />
        </button>
        <span v-if="!bookmarks.length" class="bhint" @contextmenu.prevent="onBmMenu(undefined, $event)">Закладки: ☆ в строке адреса или Ctrl+D · правый клик здесь — новая папка</span>
        <span class="grow" @contextmenu.prevent="onBmMenu(undefined, $event)"></span>
        <span v-if="pwAsk" class="pwask">
          <Icon name="lock" :size="12" />{{ pwAsk.update ? 'Обновить пароль' : 'Сохранить пароль' }} для <b>{{ hostOf(pwAsk.origin) }}</b><template v-if="pwAsk.username"> ({{ pwAsk.username }})</template>?
          <button class="primary" @click="pwReply('save')">{{ pwAsk.update ? 'Обновить' : 'Сохранить' }}</button>
          <button @click="pwReply('no')">Не сейчас</button>
          <button @click="pwReply('never')">Никогда для сайта</button>
        </span>
        <span v-if="download" class="dl" :title="download.path">
          <Icon name="download" :size="12" />{{ download.state === 'progress' ? 'Скачивается' : download.state === 'completed' ? 'Скачано' : 'Не скачано' }}: {{ download.name }}
          <button v-if="download.state === 'completed'" @click="window_show(download.path)">Показать</button>
          <button class="x" @click="download = undefined"><Icon name="x" :size="11" /></button>
        </span>
        <span class="pill">
          <button class="recb ico" :class="{ on: recState.on }" :title="recState.on ? `Остановить запись запросов (записано: ${recItems.length})` : 'Записывать запросы страниц (XHR / fetch)'" @click="toggleRec"><i></i><b v-if="recItems.length">{{ recItems.length }}</b></button>
          <button class="swb" :class="{ on: recOpen && panelMode === 'api' }" title="Swagger / OpenAPI сайта: найти и взять его запросы" @click="openSwagger(true)"><b>{}</b></button>
        </span>
        <button class="ib" :class="{ on: recOpen }" title="Записанные запросы" @click="recOpen = !recOpen"><Icon name="list" :size="14" /></button>
        <button class="ib" title="История (Ctrl+H)" @click="openHistory"><Icon name="history" :size="15" /></button>
        <button class="ib" title="Сохранённые пароли" @click="pwOpen = ''"><Icon name="lock" :size="14" /></button>
      </div>

      <div ref="panesEl" class="npanes">
        <template v-for="(p, pi) in bLayout.panes" :key="p.id">
          <div v-if="pi" class="psplit" title="Потяните — ширина" @pointerdown.prevent="onSplitResize"></div>
          <section class="pane" :class="{ cur: bLayout.cur === pi && bLayout.panes.length > 1 }" :style="{ flex: bLayout.panes.length > 1 ? `${pi ? 1 - bLayout.split : bLayout.split} 1 0` : '1 1 0' }" @pointerdown.capture="bLayout.cur = pi">
            <div class="tbar">
              <div class="tscroll">
                <TransitionGroup tag="div" name="tabmv" class="tlist">
                  <div
                    v-for="id in p.tabs"
                    :key="id"
                    class="tab"
                    :class="{ on: p.active === id, dragging: tabDrag?.id === id }"
                    :data-id="id"
                    :title="byId(id)?.url"
                    @pointerdown="onTabDown($event, pi, id)"
                    @click="onTabClick(pi, id)"
                    @mousedown.middle.prevent="closeTab(id)"
                  >
                    <span v-if="byId(id)?.loading" class="spin"></span>
                    <img v-else-if="byId(id)?.favicon" class="fav" :src="byId(id)!.favicon" alt="" />
                    <Icon v-else name="globe" :size="12" class="fav0" />
                    <span class="tname">{{ byId(id)?.title || 'Новая вкладка' }}</span>
                    <button class="tx" title="Закрыть (Ctrl+W, средняя кнопка)" @click.stop="closeTab(id)"><Icon name="x" :size="11" /></button>
                  </div>
                </TransitionGroup>
                <button class="tnew" title="Новая вкладка (Ctrl+T)" @click="newTab(pi)"><Icon name="plus" :size="13" /></button>
              </div>
              <button class="tb" :class="{ on: bLayout.panes.length > 1 }" :title="bLayout.panes.length > 1 ? 'Одна колонка (вкладки соберутся слева)' : 'Разделить: вторая колонка со своими вкладками'" @click="toggleSplit"><Icon name="columns" :size="14" /></button>
            </div>
            <div class="nav">
              <button class="tb" title="Назад (Alt+←)" :disabled="!byId(p.active)?.canBack" @click="p.active && window_nav(p.active, 'back')"><Icon name="chevronLeft" :size="15" /></button>
              <button class="tb" title="Вперёд (Alt+→)" :disabled="!byId(p.active)?.canFwd" @click="p.active && window_nav(p.active, 'fwd')"><Icon name="chevronRight" :size="15" /></button>
              <button v-if="byId(p.active)?.loading" class="tb" title="Остановить" @click="p.active && window_nav(p.active, 'stop')"><Icon name="x" :size="14" /></button>
              <button v-else class="tb" title="Обновить (F5)" :disabled="!p.active" @click="p.active && window_nav(p.active, 'reload')"><Icon name="refresh" :size="13" /></button>
              <button class="tb" title="Сбросить всё, что сайт сохранил (кэш, куки, хранилище), и перезагрузить" :disabled="!pageShown(p.active)" @click="p.active && resetSite(p.active)"><Icon name="eraser" :size="14" /></button>
              <div class="urlw">
                <button v-if="pageShown(p.active)" class="certb" :class="certCls(p.active)" title="Сведения о подключении и сертификате" @click="showCert(p.active!, $event)"><Icon :name="byId(p.active)?.url.startsWith('https:') ? 'lock' : 'globe'" :size="12" /></button>
                <input
                  :ref="(el) => el && urlEls.set(p.id, el as HTMLInputElement)"
                  class="url"
                  :class="{ painted: urlEdit[p.id] === undefined && !!urlShown(p.id, p.active) }"
                  :value="urlShown(p.id, p.active)"
                  placeholder="Адрес или поиск"
                  spellcheck="false"
                  @focus="(urlEdit[p.id] = urlShown(p.id, p.active)), ($event.target as HTMLInputElement).select()"
                  @input="onUrlInput(p.id, ($event.target as HTMLInputElement).value)"
                  @keydown="onUrlKey($event, pi)"
                  @blur="setTimeout_(() => endUrl(p.id), 150)"
                />
                <div v-if="urlEdit[p.id] === undefined && urlShown(p.id, p.active)" class="urlview" aria-hidden="true"><span v-for="(x, i) in urlParts(urlShown(p.id, p.active))" :key="i" :class="x.c">{{ x.t }}</span></div>
                <button v-if="sitePasswords(p.active).length" class="key" title="Сохранённые пароли этого сайта" @click="pwOpen = originOf(byId(p.active)?.url)"><Icon name="lock" :size="12" /></button>
                <button class="star" :class="{ on: starred(p.active) }" :title="starred(p.active) ? 'Убрать из закладок' : 'В закладки (Ctrl+D)'" :disabled="!pageShown(p.active)" @click="toggleStar(p.active)"><Icon name="star" :size="13" /></button>
                <div v-if="suggestFor === p.id" class="sug">
                  <button v-for="(s, i) in suggestions" :key="s.url" :class="{ on: i === sugIdx }" @mousedown.prevent="submitUrl(pi, s.url)">
                    <Icon :name="s.bookmark ? 'star' : 'clock'" :size="12" /><b>{{ s.title || hostOf(s.url) }}</b><span>{{ s.url }}</span>
                  </button>
                </div>
              </div>
              <ZoomChip v-if="p.active && pageShown(p.active)" :model-value="byId(p.active)?.zoom ?? 100" :min="25" :max="300" title="Масштаб страницы · колесо, Ctrl+колесо над страницей · клик — 100%" @update:model-value="(z) => p.active && window_zoom(p.active, z)" />
              <button class="tb" :class="{ on: byId(p.active)?.ruler }" :title="byId(p.active)?.ruler ? 'Убрать линейки' : 'Линейки: тяните из линейки — линия, обратно в линейку — убрать'" :disabled="!pageShown(p.active)" @click="p.active && toggleRuler(p.active)"><Icon name="ruler" :size="14" /></button>
              <button class="tb" :class="{ on: !!byId(p.active)?.device }" :title="byId(p.active)?.device ? 'Выключить режим устройства (Ctrl+Shift+M)' : 'Режим устройства: страница как на телефоне, планшете или экране нужного размера (Ctrl+Shift+M)'" :disabled="!pageShown(p.active)" @click="toggleDevice(p.active)"><Icon name="devices" :size="15" /></button>
              <button v-if="byId(p.active)?.devtools" class="tb" :title="devSide === 'right' ? 'Инструменты разработчика — вниз' : 'Инструменты разработчика — справа'" @click="devSide = devSide === 'right' ? 'bottom' : 'right'"><Icon :name="devSide === 'right' ? 'rows' : 'columns'" :size="14" /></button>
              <button class="tb" :class="{ on: byId(p.active)?.devtools }" title="Инструменты разработчика (F12)" :disabled="!pageShown(p.active)" @click="p.active && window_nav(p.active, 'devtools')"><Icon name="code" :size="14" /></button>
            </div>
            <div class="page" :class="{ dright: devSide === 'right' && byId(p.active)?.devtools }">
            <div :ref="(el) => pageRef(p.id, el)" class="pg">
              <div v-if="byId(p.active)?.loading" class="lbar"></div>
              <!-- the start page -->
              <div v-if="p.active && isBlank(byId(p.active)?.url)" class="start">
                <div class="st-h"><Icon name="globe" :size="22" />Новая вкладка</div>
                <template v-if="flatBms.length">
                  <div class="cap">Закладки</div>
                  <div class="tiles">
                    <button v-for="b in flatBms" :key="b.id" class="tile" :title="b.url" @click="openUrl(b.url!)"><Icon name="star" :size="13" /><b>{{ b.title }}</b><span>{{ hostOf(b.url!) }}</span></button>
                  </div>
                </template>
                <template v-if="popular.length">
                  <div class="cap">Часто открываете</div>
                  <div class="tiles">
                    <button v-for="h in popular" :key="h.url" class="tile" :title="h.url" @click="openUrl(h.url)"><Icon name="clock" :size="13" /><b>{{ h.title || hostOf(h.url) }}</b><span>{{ hostOf(h.url) }}</span></button>
                  </div>
                </template>
                <p v-if="!flatBms.length && !popular.length" class="muted">Введите адрес сверху (Ctrl+L) — например, localhost:5173 или любимый сайт.</p>
              </div>
              <!-- the page did not open -->
              <div v-else-if="byId(p.active)?.error" class="perr">
                <Icon name="globe" :size="28" />
                <b>{{ byId(p.active)!.error!.cert ? 'Сертификат сайта не доверенный' : 'Страница не открылась' }}</b>
                <span class="muted">{{ byId(p.active)!.error!.url }}</span>
                <code>{{ byId(p.active)!.error!.desc }} ({{ byId(p.active)!.error!.code }})</code>
                <p v-if="byId(p.active)!.error!.cert" class="muted">Так бывает у внутренних сайтов с собственным сертификатом. Если вы доверяете сайту <b>{{ byId(p.active)!.error!.host }}</b>, его можно открыть — до выхода из Qvarch.</p>
                <div class="erow">
                  <button class="primary" @click="p.active && window_nav(p.active, 'reload')">Повторить</button>
                  <button v-if="byId(p.active)!.error!.cert" @click="p.active && window_trust(p.active, byId(p.active)!.error!.host!)">Открыть всё равно</button>
                </div>
              </div>
              <!-- the device mode: its bar, and the device's page in the middle -->
              <template v-if="p.active && pageShown(p.active) && byId(p.active)?.device">
                <template v-for="dv in [byId(p.active)!.device!]" :key="p.active">
                  <div class="dbar">
                    <button class="dpick" title="Устройство" @click="deviceMenu(p.active, $event)"><span class="dname">{{ dv.name || 'Адаптивный' }}</span><Icon name="chevronDown" :size="11" /></button>
                    <input class="dnum" type="number" min="50" max="4000" :value="dv.w" title="Ширина, CSS px" @change="sizeDevice(p.active, numIn($event), dv.h)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
                    <span class="dx">×</span>
                    <input class="dnum" type="number" min="50" max="4000" :value="dv.h" title="Высота, CSS px" @change="sizeDevice(p.active, dv.w, numIn($event))" @keydown.enter="($event.target as HTMLInputElement).blur()" />
                    <button class="tb rot" title="Повернуть" @click="rotateDevice(p.active)"><Icon name="rotate" :size="13" /></button>
                    <span class="dsep"></span>
                    <button v-if="dv.mobile" class="dpick dpr" title="Плотность пикселей (DPR)" @click="dprMenu(p.active, $event)">DPR {{ dv.dpr }}<Icon name="chevronDown" :size="11" /></button>
                    <span v-else class="dpick dpr off" title="У компьютера плотность пикселей — как у вашего экрана. Своя плотность — у мобильных устройств (включите «Касания»)">DPR экрана</span>
                    <button class="dchip" :class="{ on: dv.mobile }" :title="dv.mobile ? 'Мобильное устройство: касания вместо мыши, мобильный User-Agent. Клик — как компьютер' : 'Как компьютер. Клик — мобильное: касания и мобильный User-Agent'" @click="patchDevice(p.active, { mobile: !dv.mobile })"><i></i><span>Касания</span></button>
                    <span class="grow"></span>
                    <span v-if="devFits[p.id]" class="dscale" :title="devFits[p.id].scale < 1 ? 'Не помещается — показано уменьшенным' : 'В натуральную величину'">{{ Math.round(devFits[p.id].scale * 100) }}%</span>
                    <button class="tb" title="Выключить режим устройства (Ctrl+Shift+M)" @click="setDevice(p.active)"><Icon name="x" :size="13" /></button>
                  </div>
                  <div :ref="(el) => areaRef(p.id, el)" class="darea">
                    <div v-if="devFits[p.id]" class="dframe" :style="{ left: devFits[p.id].x + 'px', top: devFits[p.id].y + 'px', width: devFits[p.id].w + 'px', height: devFits[p.id].h + 'px' }">
                      <img v-if="shots[p.active]" class="shot" :src="`data:image/jpeg;base64,${shots[p.active]}`" alt="" />
                    </div>
                  </div>
                </template>
              </template>
              <!-- the page's picture while something of the app is over it -->
              <img v-if="p.active && shots[p.active] && !byId(p.active)?.device" class="shot" :src="`data:image/jpeg;base64,${shots[p.active]}`" alt="" />
            </div>
            <!-- the developer tools, docked under the page -->
            <template v-if="p.active && pageShown(p.active) && byId(p.active)?.devtools">
              <div class="dgrip" title="Потяните — высота инструментов разработчика" @pointerdown="dragDev"></div>
              <div :ref="(el) => devRef(p.id, el)" class="dv" :style="devSide === 'right' ? { width: devW + 'px' } : { height: devH + 'px' }">
                <img v-if="shots[p.active + ':dev']" class="shot" :src="`data:image/jpeg;base64,${shots[p.active + ':dev']}`" alt="" />
              </div>
            </template>
            </div>
            <template v-if="tabDrag">
              <template v-if="bLayout.panes.length === 1 && p.tabs.length > 1">
                <div class="dz l" :class="{ hot: zone?.side === 'left' }"><span>Разделить влево</span></div>
                <div class="dz r" :class="{ hot: zone?.side === 'right' }"><span>Разделить вправо</span></div>
              </template>
              <div v-else-if="bLayout.panes.length > 1 && tabDrag.pane !== pi" class="dz all" :class="{ hot: zone?.pane === pi }"><span>Перенести сюда</span></div>
            </template>
          </section>
        </template>
      </div>
    </section>

    <!-- the recorded requests -->
    <aside v-if="recOpen" class="rec">
      <span class="rgrip" @pointerdown="dragRec"></span>
      <div class="pmode">
        <button :class="{ on: panelMode === 'rec' }" @click="panelMode = 'rec'"><i class="rdot" :class="{ on: recState.on }"></i>Запись<b v-if="recItems.length">{{ recItems.length }}</b></button>
        <button :class="{ on: panelMode === 'api' }" @click="openSwagger(false)">Swagger<b v-if="api">{{ api.info.ops.length }}</b></button>
        <span class="grow"></span>
        <button class="ib" title="Скрыть" @click="recOpen = false"><Icon name="x" :size="13" /></button>
      </div>
      <template v-if="panelMode === 'api'">
        <div class="rh">
          <button class="primary sm" :disabled="apiBusy || !pageShown(curId)" @click="findSwagger"><Icon name="search" :size="12" />{{ apiBusy ? 'Ищу…' : api ? 'Искать заново' : 'Найти на этом сайте' }}</button>
          <span class="grow"></span>
          <button class="ib" title="Очистить" :disabled="!api && !apiError" @click="clearApi"><Icon name="trash" :size="13" /></button>
        </div>
        <div v-if="api" class="apih" :title="api.url">
          <b>{{ api.info.title }}</b><span>{{ api.info.version }}</span><em>{{ api.info.kind }}</em>
          <div class="apiu">{{ api.url }}</div>
        </div>
        <p v-if="apiError" class="rerr">{{ apiError }}<template v-if="apiTried.length"> · проверено адресов: {{ apiTried.length }}</template></p>
        <template v-if="api">
          <div class="rf">
            <input type="checkbox" :checked="apiAll" title="Выбрать все показанные" @change="apiPickAll(($event.target as HTMLInputElement).checked)" />
            <input v-model="apiQ" class="rq" placeholder="Фильтр: метод, путь, описание, тег" spellcheck="false" />
          </div>
          <div class="rlist">
            <template v-for="g in apiGroups" :key="g.tag">
              <label class="atag"><input type="checkbox" :checked="g.ops.every((o) => apiPicked.has(o.id))" @change="apiPickGroup(g.ops, ($event.target as HTMLInputElement).checked)" />{{ g.tag }}<span>{{ g.ops.length }}</span></label>
              <label v-for="o in g.ops" :key="o.id" class="ri api" :class="{ picked: apiPicked.has(o.id), dep: o.deprecated }" :title="o.summary">
                <input type="checkbox" :checked="apiPicked.has(o.id)" @change="apiToggle(o.id)" />
                <b class="rm" :style="{ color: mColor(o.method) }">{{ o.method }}</b>
                <span class="rp">{{ o.path }}<span v-if="o.summary" class="rsum"> — {{ o.summary }}</span></span>
              </label>
            </template>
          </div>
          <div class="rfoot">
            <span class="muted">Выбрано: {{ apiPicked.size }}</span>
            <span class="grow"></span>
            <button class="primary" :disabled="!apiPicked.size" @click="apiAsk = true">В HTTP →</button>
          </div>
        </template>
        <p v-else-if="!apiBusy" class="none">Откройте сайт (или его Swagger UI) и нажмите «Найти»: Qvarch посмотрит, что показывает страница, и проверит обычные адреса описания API — /v3/api-docs, /swagger.json, /openapi.json, /api-json и другие.</p>
      </template>
      <template v-else>
      <div class="rh">
        <button class="recb" :class="{ on: recState.on }" @click="toggleRec"><i></i>{{ recState.on ? 'Остановить' : 'Начать запись' }}</button>
        <label class="rdocs" title="Записывать и сами страницы (документы), не только XHR / fetch"><input type="checkbox" :checked="recState.documents" @change="setDocs(($event.target as HTMLInputElement).checked)" />+ страницы</label>
        <span class="grow"></span>
        <button class="ib" title="Очистить" :disabled="!recItems.length" @click="clearRec"><Icon name="trash" :size="13" /></button>
      </div>
      <p v-if="recError" class="rerr">{{ recError }}</p>
      <div class="rf">
        <input type="checkbox" :checked="allPicked" title="Выбрать все показанные" @change="pickAll(($event.target as HTMLInputElement).checked)" />
        <input v-model="recQ" class="rq" placeholder="Фильтр: метод, адрес, статус" spellcheck="false" />
      </div>
      <div class="rlist">
        <template v-for="x in shownItems" :key="x.id">
          <div class="ri" :class="{ picked: picked.has(x.id), open: focus?.id === x.id, failed: !!x.error }" @click="openItem(x)">
            <input type="checkbox" :checked="picked.has(x.id)" @click.stop="togglePick(x.id)" />
            <span class="rn">{{ x.seq }}</span>
            <b class="rm" :style="{ color: mColor(x.method) }">{{ x.method }}</b>
            <span class="rp" :title="x.url"><span class="rhost">{{ hostOf(x.url) }}</span>{{ pathOf(x.url) }}</span>
            <b class="rs" :class="statusCls(x.status)">{{ x.error ? '✕' : (x.status ?? '…') }}</b>
            <span class="rt">{{ x.type === 'Document' ? 'стр.' : x.type === 'Fetch' ? 'fetch' : 'xhr' }}</span>
          </div>
          <div v-if="focus?.id === x.id" class="rd">
            <div class="rdt">
              <button :class="{ on: focusTab === 'req' }" @click="focusTab = 'req'">Запрос</button>
              <button :class="{ on: focusTab === 'res' }" @click="focusTab = 'res'">Ответ {{ focus.status ?? '' }}</button>
              <span class="grow"></span>
              <span class="muted">{{ hms(focus.at) }}<template v-if="focus.ms"> · {{ focus.ms }} мс</template></span>
            </div>
            <template v-if="focusTab === 'req'">
              <div class="kvs">
                <div v-for="[k, v] in focus.reqHeaders" :key="k"><b>{{ k }}</b><span>{{ v }}</span></div>
              </div>
              <pre v-if="focus.postData" class="body">{{ pretty(focus.postData) }}</pre>
            </template>
            <template v-else>
              <p v-if="focus.error" class="rerr">{{ focus.error }}</p>
              <div class="kvs">
                <div v-for="[k, v] in focus.resHeaders ?? []" :key="k"><b>{{ k }}</b><span>{{ v }}</span></div>
              </div>
              <pre v-if="focus.resBody" class="body">{{ pretty(focus.resBody).slice(0, 20000) }}</pre>
              <p v-else class="muted">Тело ответа не сохранено (файл, картинка или очень большой ответ)</p>
            </template>
          </div>
        </template>
        <p v-if="!recItems.length" class="none">{{ recState.on ? 'Пишу… Делайте на странице то, что нужно: загрузите данные, создайте запись — запросы появятся здесь.' : 'Нажмите «Начать запись», сделайте на странице нужные действия и остановите запись.' }}</p>
      </div>
      <div class="rfoot">
        <span class="muted">Выбрано: {{ picked.size }}</span>
        <span class="grow"></span>
        <button class="primary" :disabled="!picked.size" @click="startTransfer">В HTTP →</button>
      </div>
      </template>
    </aside>

    <Teleport to="body">
      <!-- a bookmark folder's contents -->
      <div v-if="folderPop && popFolder" ref="popEl" class="bmpop" :style="{ left: folderPop.x + 'px', top: folderPop.y + 'px' }" @keydown.esc="folderPop = undefined">
        <div v-if="folderPop.trail.length" class="bmph"><button @click="folderBack"><Icon name="chevronLeft" :size="12" /></button>{{ popFolder.title }}</div>
        <button
          v-for="c in popFolder.children"
          :key="c.id"
          class="bmrow"
          :class="[{ dragging: bmDrag === c.id }, dropCls(c.id)]"
          :data-bm="c.id"
          :title="c.url ?? c.title"
          @pointerdown="onBmDown($event, c)"
          @auxclick.prevent="$event.button === 1 && c.url && openUrl(c.url, true)"
          @contextmenu.prevent="onBmMenu(c, $event)"
        >
          <Icon v-if="c.children" name="folder" :size="13" class="bfi" /><img v-else-if="c.icon && !badIcon.has(c.id)" class="bico" :src="c.icon" alt="" @error="badIcon.add(c.id)" /><Icon v-else name="globe" :size="13" class="bfi0" />
          <span>{{ c.title }}</span>
          <Icon v-if="c.children" name="chevronRight" :size="11" />
        </button>
        <p v-if="!popFolder.children?.length" class="bmempty">Пусто — перетащите сюда закладку</p>
      </div>
      <div v-if="bmGhost" class="bghost bv-ignore" :style="{ left: bmGhost.x + 12 + 'px', top: bmGhost.y + 10 + 'px' }">{{ bmGhost.title }}</div>
      <!-- the site's connection -->
      <div v-if="cert" ref="certEl" class="certpop" :style="{ left: cert.x + 'px', top: cert.y + 'px' }">
        <template v-if="!cert.info.secure">
          <div class="ch bad"><Icon name="globe" :size="14" />Соединение не защищено</div>
          <p>Сайт <b>{{ cert.info.host }}</b> открыт по http: всё, что вы вводите (в том числе пароли), передаётся открытым текстом.</p>
        </template>
        <template v-else>
          <div class="ch" :class="{ bad: cert.info.ok === false || cert.info.trusted }"><Icon name="lock" :size="14" />{{ cert.info.trusted ? 'Сертификат не доверенный — открыт по вашему решению' : cert.info.ok === false ? 'Сертификат не прошёл проверку' : 'Соединение защищено' }}</div>
          <template v-if="cert.info.subject">
            <div class="cs">Кому выдан</div>
            <div class="cr2"><span>Общее имя (CN)</span><b>{{ cert.info.subject.CN ?? '—' }}</b></div>
            <div class="cr2"><span>Организация (O)</span><b>{{ cert.info.subject.O ?? '<не указана>' }}</b></div>
            <div class="cr2"><span>Подразделение (OU)</span><b>{{ cert.info.subject.OU ?? '<не указано>' }}</b></div>
            <div class="cs">Кем выдан</div>
            <div class="cr2"><span>Общее имя (CN)</span><b>{{ cert.info.issuer?.CN ?? '—' }}</b></div>
            <div class="cr2"><span>Организация (O)</span><b>{{ cert.info.issuer?.O ?? '<не указана>' }}</b></div>
            <div class="cr2"><span>Подразделение (OU)</span><b>{{ cert.info.issuer?.OU ?? '<не указано>' }}</b></div>
            <div class="cs">Срок действия</div>
            <div class="cr2"><span>Дата выдачи</span><b>{{ longDate(cert.info.validFrom) }}</b></div>
            <div class="cr2"><span>Действует до</span><b :class="{ warn: (cert.info.validTo ?? 0) - Date.now() < 14 * 864e5 }">{{ longDate(cert.info.validTo) }}</b></div>
            <template v-if="cert.info.san?.length">
              <div class="cs">Для адресов</div>
              <div class="csan">{{ cert.info.san.join(', ') }}</div>
            </template>
            <template v-if="cert.info.chain?.length">
              <div class="cs">Цепочка</div>
              <div class="csan">{{ [cert.info.subject.CN, ...cert.info.chain].join(' ← ') }}</div>
            </template>
            <div class="cs">Отпечатки SHA-256</div>
            <div class="cr2"><span>Сертификат</span><code>{{ cert.info.sha256 }}</code></div>
            <div class="cr2"><span>Открытый ключ</span><code>{{ cert.info.keySha256 }}</code></div>
            <div class="cr2"><span>Серийный номер</span><code>{{ cert.info.serial }}</code></div>
          </template>
          <p v-else class="muted">Подробности сертификата появятся после следующего соединения с сайтом (обновите страницу).</p>
          <p v-if="cert.info.result && cert.info.result !== 'net::OK'" class="bad">{{ cert.info.result }}</p>
        </template>
      </div>
      <!-- the dragged tab follows the pointer -->
      <div v-if="tabDrag" class="bghost bv-ignore" :style="{ left: tabDrag.x + 12 + 'px', top: tabDrag.y + 10 + 'px' }">{{ byId(tabDrag.id)?.title }}</div>
      <!-- the chain into the HTTP section -->
      <div v-if="transfer && transferPreview" class="bq-back" @mousedown.self="transfer = undefined">
        <div class="bq wide" tabindex="-1" @keydown.esc="transfer = undefined">
          <div class="cap">В HTTP: папка «{{ transferPreview.folder.name }}»</div>
          <div class="tlist2">
            <div v-for="r in transferPreview.folder.children" :key="r.id" class="tl2"><b :style="{ color: mColor((r as { method: string }).method) }">{{ (r as { method: string }).method }}</b>{{ r.name }}</div>
          </div>
          <label class="tqc"><input v-model="transfer.base" type="checkbox" />Адрес сервера — в переменную <code>{{ BASE_VAR }}</code> (чтобы направить цепочку на другой стенд)</label>
          <label class="tqc"><input v-model="transfer.secrets" type="checkbox" />Токены, куки и ключи — в секретные переменные (хранятся зашифрованными)</label>
          <template v-if="transfer.links.length">
            <div class="cap">Связи: значения из ответов, которые использованы дальше</div>
            <p class="hint">Отмеченные будут браться из ответа при каждом запуске, а не повторять записанные. Снимите галочку, если совпадение случайное.</p>
            <div class="links">
              <label v-for="l in transfer.links" :key="l.varName" class="lk">
                <input v-model="l.on" type="checkbox" />
                <code>{{ l.varName }}</code>
                <span class="lv" :title="l.value">= {{ l.value.length > 40 ? l.value.slice(0, 40) + '…' : l.value }}</span>
                <span class="muted">из ответа №{{ l.from + 1 }} → {{ useText(l) }}</span>
              </label>
            </div>
          </template>
          <p v-else class="hint">Связей между запросами не найдено — запросы перенесутся с записанными значениями.</p>
          <div class="tqb"><button class="primary" @click="doTransfer">Создать в HTTP ({{ transferPreview.folder.children.length }})</button><button @click="transfer = undefined">Отмена</button></div>
        </div>
      </div>
      <!-- the history -->
      <div v-if="histOpen" class="bq-back" @mousedown.self="histOpen = false">
        <div class="bq hist" tabindex="-1" @keydown.esc="histOpen = false">
          <div class="hh">
            <span class="cap">История</span>
            <label class="hsw" :title="bSettings.history ? 'Открытые страницы запоминаются' : 'Открытые страницы не запоминаются'"><input type="checkbox" :checked="bSettings.history" @change="setHistoryOn(($event.target as HTMLInputElement).checked)" /><i></i>Сохранять историю</label>
            <span class="grow"></span>
            <button class="hclr" :disabled="!visits.length" @click="histClear">Удалить<Icon name="chevronDown" :size="11" /></button>
            <button class="ib" title="Закрыть (Esc)" @click="histOpen = false"><Icon name="x" :size="14" /></button>
          </div>
          <label class="hsearch"><Icon name="search" :size="13" /><input :ref="(el) => el && histOpen && !histQ && (el as HTMLInputElement).focus()" v-model="histQ" placeholder="Поиск: название или адрес" spellcheck="false" /><span v-if="histQ" class="muted">{{ histFound.length }}</span></label>
          <p v-if="!bSettings.history" class="hoff">История не сохраняется: новые страницы не запоминаются. Уже сохранённое осталось — его можно удалить.</p>
          <div class="hlist">
            <template v-for="d in histDays" :key="d.k">
              <div class="hday"><span class="hdt">{{ d.title }}</span><span class="muted">{{ d.total }}</span><button class="hdel" title="Удалить этот день из истории" @click="histDelDay(d.k, d.title)"><Icon name="trash" :size="12" /></button></div>
              <div v-for="v in d.items" :key="v.id" class="hrow" :title="v.url" @click="histGo(v, $event)" @mousedown.middle.prevent @auxclick.prevent="$event.button === 1 && histGo(v, $event)">
                <span class="htm">{{ hhmm(v.at) }}</span>
                <span class="htt">{{ v.title || v.url }}</span>
                <span class="hurl">{{ hostOf(v.url) }}</span>
                <button class="hdel" title="Удалить из истории" @click.stop="histDel([v.id])"><Icon name="x" :size="12" /></button>
              </div>
            </template>
            <button v-if="histFound.length > histLimit" class="hmore" @click="histLimit += 500">Показать ещё ({{ histFound.length - histLimit }})</button>
            <p v-if="!visits.length" class="hint hempty">{{ bSettings.history ? 'История пуста. Здесь появятся страницы, которые вы открываете, — по дням, со временем открытия.' : 'История пуста и не сохраняется.' }}</p>
            <p v-else-if="!histFound.length" class="hint hempty">Ничего не нашлось</p>
          </div>
          <p class="hint hfoot">Клик — открыть, Ctrl+клик или средняя кнопка — в новой вкладке. Хранится 90 дней, только на этом компьютере.</p>
        </div>
      </div>
      <!-- the saved passwords -->
      <div v-if="pwOpen !== undefined" class="bq-back" @mousedown.self="pwOpen = undefined">
        <div class="bq wide" tabindex="-1" @keydown.esc="pwOpen = undefined">
          <div class="cap">Сохранённые пароли{{ pwOpen ? ` · ${hostOf(pwOpen)}` : '' }}</div>
          <p class="hint">Хранятся на этом компьютере зашифрованными (Windows, только для вашей учётной записи). Сайт получает пароль, только когда открыт именно он.</p>
          <input v-if="!pwOpen" v-model="pwQ" placeholder="Поиск: сайт или логин" spellcheck="false" />
          <div class="pws">
            <div v-for="x in pwList" :key="x.id" class="pw">
              <span class="pws-site" :title="x.origin">{{ hostOf(x.origin) }}</span>
              <span class="pws-user">{{ x.username || '(без логина)' }}</span>
              <code class="pws-pass">{{ pwShown[x.id] ?? '••••••••' }}</code>
              <button title="Показать / скрыть" @click="pwToggle(x.id)"><Icon :name="pwShown[x.id] !== undefined ? 'eyeOff' : 'eye'" :size="12" /></button>
              <button title="Копировать пароль" @click="pwCopy(x.id)"><Icon name="copy" :size="12" /></button>
              <button v-if="pwOpen && originOf(byId(curId)?.url) === x.origin" title="Подставить в форму входа на странице" @click="pwFill(x)">Подставить</button>
              <button title="Удалить" @click="pwDel(x)"><Icon name="trash" :size="12" /></button>
            </div>
            <p v-if="!pwList.length" class="hint">Сохранённых паролей нет. Когда вы входите на сайт, Qvarch предложит сохранить пароль (полоса сверху).</p>
          </div>
          <template v-if="!pwOpen && never.length">
            <div class="cap">Не предлагать для сайтов</div>
            <div class="pws">
              <div v-for="o in never" :key="o" class="pw">
                <span class="pws-site">{{ hostOf(o) }}</span>
                <span class="grow"></span>
                <button @click="(window_never(o), (never = never.filter((x) => x !== o)))">Убрать из списка</button>
              </div>
            </div>
          </template>
          <div class="tqb"><button @click="pwOpen = undefined">Закрыть</button></div>
        </div>
      </div>
      <!-- Swagger → HTTP: what to fill in -->
      <div v-if="apiAsk && api" class="bq-back" @mousedown.self="apiAsk = false">
        <form class="bq" @submit.prevent="apiToHttp" @keydown.esc="apiAsk = false">
          <div class="cap">В HTTP: {{ api.info.title }} · запросов: {{ apiPicked.size }}</div>
          <label class="tqc"><input v-model="apiOpts.defaults" type="checkbox" />Заполнить значениями из описания — default, example, первый вариант enum (в параметрах, пути и теле)</label>
          <label class="tqc"><input v-model="apiOpts.optional" type="checkbox" />Включить и необязательные параметры (иначе — только обязательные)</label>
          <p class="hint">Где описание ничего не предлагает, останется пусто: строка — "", число — 0, false, [].</p>
          <div class="tqb"><button type="submit" class="primary">Создать в HTTP</button><button type="button" @click="apiAsk = false">Отмена</button></div>
        </form>
      </div>
      <!-- a site asks to sign in -->
      <div v-if="login" class="bq-back">
        <form class="bq" @submit.prevent="loginDone(true)" @keydown.esc="loginDone(false)">
          <div class="cap">Вход: {{ login.host }}</div>
          <p v-if="login.realm" class="hint">{{ login.realm }}</p>
          <label class="tqf">Логин<input v-model="login.user" autofocus spellcheck="false" /></label>
          <label class="tqf">Пароль<input v-model="login.pass" type="password" /></label>
          <div class="tqb"><button type="submit" class="primary">Войти</button><button type="button" @click="loginDone(false)">Отмена</button></div>
        </form>
      </div>
      <!-- a bookmark / a folder -->
      <div v-if="bmEdit" class="bq-back" @mousedown.self="bmEdit = undefined">
        <form class="bq" @submit.prevent="saveBmEdit" @keydown.esc="bmEdit = undefined">
          <div class="cap">{{ bmEdit.isFolder ? (bmEdit.id ? 'Папка' : 'Новая папка') : bmEdit.id ? 'Закладка' : 'Новая закладка — куда сохранить?' }}</div>
          <label class="tqf">Название<input v-model="bmEdit.title" spellcheck="false" /></label>
          <label v-if="!bmEdit.isFolder" class="tqf">Адрес<input v-model="bmEdit.url" spellcheck="false" /></label>
          <label class="tqf">
            Где
            <select v-model="bmEdit.folder">
              <option value="">Панель закладок</option>
              <option v-for="f in folders.filter((x) => x.id !== bmEdit!.id)" :key="f.id" :value="f.id">{{ f.title }}</option>
            </select>
          </label>
          <div class="tqb"><button type="submit" class="primary">Сохранить</button><button type="button" @click="bmEdit = undefined">Отмена</button></div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.bv {
  display: grid;
  height: 100%;
  min-height: 0;
}
.grow {
  flex: 1;
}
.bmain {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
/* ---------- the top bar: bookmarks, the recording ---------- */
.bbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  overflow: hidden;
  white-space: nowrap;
}
.bm {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 180px;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  touch-action: none;
}
.bm span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.bm:hover {
  background: var(--hover);
  color: var(--text);
}
.bm.dragging {
  background: rgb(var(--accent-rgb) / 0.18);
}
.bfi {
  color: var(--warn);
}
.bfi0 {
  color: var(--muted);
}
.bico {
  flex: none;
  width: 14px;
  height: 14px;
}
.bm.open {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--text-hi);
}
.bm.dropin,
.bm.drop-before,
.bm.drop-after {
  background: rgb(var(--accent-rgb) / 0.2);
}
.bm.drop-before {
  box-shadow: inset 2px 0 0 var(--accent);
}
.bm.drop-after {
  box-shadow: inset -2px 0 0 var(--accent);
}
.bm.dropin {
  outline: 1px solid var(--accent);
}
.certb {
  position: absolute;
  left: 5px;
  z-index: 1;
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
}
.certb:hover {
  background: var(--hover);
}
.certb.sec {
  color: var(--up-fg);
}
.certb.insec {
  color: var(--down-fg);
}
.page.dright {
  flex-direction: row;
}
.page.dright .dgrip {
  width: 5px;
  height: auto;
  cursor: col-resize;
}
.bhint {
  color: var(--muted);
  font-size: 11.5px;
}
.dl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 340px;
  padding: 0 4px 0 8px;
  height: 24px;
  border-radius: var(--r2);
  background: rgba(0, 230, 118, 0.1);
  color: var(--up-fg);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dl button {
  padding: 1px 6px;
  font-size: 11px;
}
.dl .x {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.pill {
  flex: none;
  display: inline-flex;
}
.pill .recb {
  border-radius: var(--r2) 0 0 var(--r2);
}
.recb.ico {
  padding: 0 9px;
  gap: 5px;
}
.swb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-left: 0;
  border-radius: 0 var(--r2) var(--r2) 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.swb b {
  color: var(--up-fg);
  font-family: var(--font-data);
  font-size: 11px;
}
.swb.on {
  background: rgba(0, 230, 118, 0.12);
  color: var(--up-fg);
}
.pmode {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 36px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
}
.pmode > button:not(.ib) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
}
.pmode > button.on {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--text-hi);
}
.pmode b {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--panel-3);
  font-size: 10.5px;
}
.rdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dim);
}
.rdot.on {
  background: var(--down);
  animation: bv-blink 1s steps(2) infinite;
}
.primary.sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}
.apih {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}
.apih b {
  color: var(--text-hi);
}
.apih span {
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.apih em {
  color: var(--up-fg);
  font-style: normal;
  font-size: 11px;
}
.apiu {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.atag {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  background: var(--panel-2);
  color: var(--text-hi);
  font-size: 12px;
  font-weight: 600;
}
.atag span {
  color: var(--muted);
  font-weight: 400;
}
.ri.api {
  grid-template-columns: 18px 56px minmax(0, 1fr);
}
.ri.dep .rp {
  text-decoration: line-through;
  opacity: 0.6;
}
.rsum {
  color: var(--muted);
  font-family: var(--font-ui);
}
.recb {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.recb i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--down);
}
.recb b {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--panel-3);
  font-size: 10.5px;
  font-weight: 600;
}
.recb.on {
  border-color: var(--down);
  background: rgba(255, 61, 61, 0.14);
  color: var(--down-fg);
}
.recb.on i {
  animation: bv-blink 1s steps(2) infinite;
}
@keyframes bv-blink {
  50% {
    opacity: 0.25;
  }
}
.ib,
.tb {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ib:hover:not(:disabled),
.tb:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.ib.on,
.tb.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--accent-fg);
}
.ib:disabled,
.tb:disabled {
  opacity: 0.35;
}
/* ---------- panes ---------- */
.npanes {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}
.pane {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.pane.cur::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: rgb(var(--accent-rgb) / 0.8);
  pointer-events: none;
}
.psplit {
  flex: none;
  width: 5px;
  margin: 0 -2px;
  padding: 0 2px;
  background: var(--border);
  background-clip: content-box;
  cursor: col-resize;
  z-index: 2;
}
.psplit:hover {
  background-color: rgb(var(--accent-rgb) / 0.85);
}
.tbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 36px;
  padding: 0 6px 0 4px;
  background: var(--bg);
}
.tscroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  align-self: stretch;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.tlist {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
}
.tabmv-move {
  transition: transform 0.16s ease;
}
.tab {
  flex: 0 1 200px;
  min-width: 90px;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 6px 0 10px;
  border-radius: 6px 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  touch-action: none;
}
.tab:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}
.tab.on {
  background: var(--panel);
  color: var(--text-hi);
}
.tab.dragging {
  background: rgb(var(--accent-rgb) / 0.16);
}
.fav {
  flex: none;
  width: 14px;
  height: 14px;
}
.fav0 {
  flex: none;
  color: var(--muted);
}
.spin {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: bv-spin 0.8s linear infinite;
}
@keyframes bv-spin {
  to {
    transform: rotate(360deg);
  }
}
.tname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx {
  flex: none;
  display: inline-flex;
  padding: 2px;
  border: 0;
  border-radius: var(--r2);
  background: none;
  color: var(--muted);
  opacity: 0;
}
.tab:hover .tx,
.tab.on .tx {
  opacity: 1;
}
.tx:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--down-fg);
}
.tnew {
  flex: none;
  /* level with the tabs (they sit at the bottom of the bar) */
  align-self: flex-end;
  margin-bottom: 4px;
  display: inline-flex;
  padding: 5px;
  border: 0;
  border-radius: var(--r2);
  background: none;
  color: var(--muted);
}
.tnew:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.nav {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 38px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.nav :deep(.zc) {
  height: 28px;
}
.urlw {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.url {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 32px 0 30px;
  border-radius: var(--r2);
  font-family: var(--font-data);
  font-size: 12.5px;
}
.url.painted {
  color: transparent;
  caret-color: transparent;
}
.urlview {
  position: absolute;
  left: 31px;
  right: 56px;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: pre;
  pointer-events: none;
  font-family: var(--font-data);
  font-size: 12.5px;
}
.urlview span {
  flex: none;
}
.u-scheme {
  color: var(--muted);
}
.u-host {
  color: var(--text-hi);
}
.u-path {
  color: var(--text-2);
}
.u-sep {
  color: var(--muted);
}
.u-key {
  color: var(--accent-fg);
}
.u-val {
  color: var(--accent);
}
.u-hash {
  color: var(--info-fg);
}
.star {
  position: absolute;
  right: 4px;
  display: inline-flex;
  padding: 5px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.star.on {
  color: var(--warn);
}
.star.on :deep(svg) {
  fill: currentColor;
}
.sug {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.sug button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
}
.sug button.on,
.sug button:hover {
  background: var(--hover);
}
.sug b {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sug span {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.pg {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  container: pg / inline-size;
}
.dgrip {
  flex: none;
  height: 5px;
  background: var(--border);
  cursor: row-resize;
}
.dgrip:hover {
  background: rgb(var(--accent-rgb) / 0.85);
}
.dv {
  position: relative;
  flex: none;
  background: var(--panel);
}
.key {
  position: absolute;
  right: 28px;
  display: inline-flex;
  padding: 5px;
  border: 0;
  background: transparent;
  color: var(--warn);
}
.pwask {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
  padding: 0 4px 0 8px;
  height: 26px;
  border-radius: var(--r2);
  background: rgba(255, 183, 77, 0.12);
  color: var(--warn-fg);
  font-size: 12px;
}
.pwask b {
  color: var(--text-hi);
}
.pwask button {
  height: 20px;
  padding: 0 8px;
  font-size: 11.5px;
}
.lbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  background-size: 50% 100%;
  animation: bv-load 1s linear infinite;
}
@keyframes bv-load {
  from {
    background-position: -50% 0;
  }
  to {
    background-position: 150% 0;
  }
}
/* ---------- the device mode ---------- */
.dbar {
  position: absolute;
  inset: 0 0 auto;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 6px 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  white-space: nowrap;
  overflow: hidden;
}
.dpick {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12px;
}
.dname {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* narrow: the secondary goes first, the bar never wraps nor cuts its close button */
@container pg (max-width: 640px) {
  .dsep,
  .dscale {
    display: none;
  }
}
@container pg (max-width: 540px) {
  .dchip span {
    display: none;
  }
  .dname {
    max-width: 90px;
  }
}
@container pg (max-width: 470px) {
  .dpick.dpr {
    display: none;
  }
}
@container pg (max-width: 390px) {
  .dbar .tb.rot {
    display: none;
  }
  .dnum {
    width: 50px;
  }
}
.dpick.off {
  border-style: dashed;
  color: var(--muted);
  cursor: default;
}
.dpick:not(.off):hover {
  background: rgba(255, 255, 255, 0.07);
}
.dpick :deep(svg) {
  color: var(--muted);
}
.dnum {
  flex: none;
  width: 62px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
  text-align: center;
  -moz-appearance: textfield;
}
.dnum::-webkit-inner-spin-button,
.dnum::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.dx {
  color: var(--muted);
  font-size: 12px;
}
.dsep {
  flex: none;
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--border);
}
.dchip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.dchip i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--panel-3);
}
.dchip.on {
  color: var(--text);
  border-color: rgb(var(--accent-rgb) / 0.5);
}
.dchip.on i {
  background: var(--accent);
}
.dscale {
  flex: none;
  padding: 0 6px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.darea {
  position: absolute;
  inset: 34px 0 0;
  overflow: hidden;
  background: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.015) 0 8px, transparent 8px 16px), var(--bg);
}
.dframe {
  position: absolute;
  background: #fff;
  box-shadow:
    0 0 0 1px var(--border-2),
    0 8px 30px rgba(0, 0, 0, 0.45);
}
.shot {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.start {
  height: 100%;
  overflow: auto;
  padding: 40px max(24px, 8%);
}
.st-h {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
  color: var(--text-hi);
  font-size: 20px;
  font-weight: 600;
}
.st-h :deep(svg) {
  color: var(--accent);
}
.start .cap {
  margin: 18px 0 8px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}
.tile {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--panel);
  text-align: left;
}
.tile:hover {
  border-color: var(--accent-line);
}
.tile :deep(svg) {
  grid-row: span 2;
  color: var(--warn);
}
.tile b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 500;
  font-size: 12.5px;
}
.tile span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}
.perr {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 24px;
  text-align: center;
}
.perr :deep(svg) {
  color: var(--down-fg);
}
.perr b {
  color: var(--text-hi);
  font-size: 16px;
}
.perr code {
  color: var(--down-fg);
  font-family: var(--font-data);
}
.perr p {
  max-width: 520px;
}
.erow {
  display: flex;
  gap: 8px;
}
.dz {
  position: absolute;
  top: 74px;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed transparent;
  border-radius: 4px;
  color: transparent;
  font-size: 13px;
  pointer-events: none;
}
.dz.l {
  left: 0;
  width: 30%;
}
.dz.r {
  right: 0;
  width: 30%;
}
.dz.all {
  left: 0;
  right: 0;
}
.dz.hot {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.14);
  color: var(--accent-fg);
}
/* ---------- the recording ---------- */
.rec {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--panel);
}
.rgrip {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  z-index: 3;
  width: 6px;
  cursor: col-resize;
}
.rgrip:hover {
  background: var(--accent-line);
}
.rh {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--border);
}
.rdocs {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-2);
  font-size: 12px;
}
.rerr {
  margin: 6px 10px;
  color: var(--down-fg);
  font-size: 12px;
}
.rf {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}
.rq {
  flex: 1;
  height: 28px;
  font-size: 12px;
}
.rlist {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.ri {
  min-width: 0;
  max-width: 100%;
  display: grid;
  grid-template-columns: 18px 30px 52px minmax(0, 1fr) 34px 34px;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  cursor: default;
}
.ri:hover {
  background: var(--hover);
}
.ri.picked {
  background: rgb(var(--accent-rgb) / 0.1);
}
.ri.open {
  background: var(--panel-2);
}
.ri.failed .rp {
  color: var(--down-fg);
}
.rn {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  text-align: right;
}
.rm {
  font-family: var(--font-data);
  font-size: 11px;
}
.rp {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-data);
  font-size: 11.5px;
}
.rhost {
  margin-right: 2px;
  color: var(--muted);
}
.rs {
  font-family: var(--font-data);
  font-size: 11.5px;
  text-align: right;
}
.rs.s2 {
  color: var(--up-fg);
}
.rs.s3 {
  color: var(--info-fg);
}
.rs.e4 {
  color: var(--warn-fg);
}
.rs.e5 {
  color: var(--down-fg);
}
.rt {
  color: var(--muted);
  font-size: 10.5px;
}
.rd {
  padding: 6px 10px 10px 34px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}
.rdt {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  font-size: 11.5px;
}
.rdt button {
  padding: 2px 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.rdt button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--text-hi);
}
.kvs {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-family: var(--font-data);
  font-size: 11px;
}
.kvs div {
  display: grid;
  grid-template-columns: minmax(80px, 34%) minmax(0, 1fr);
  gap: 8px;
}
.kvs b {
  color: var(--text-2);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kvs span {
  overflow-wrap: anywhere;
}
.body {
  max-height: 260px;
  overflow: auto;
  margin: 8px 0 0;
  padding: 8px;
  border-radius: var(--r2);
  background: var(--bg);
  font-family: var(--font-data);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}
.none {
  margin: 14px;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.5;
}
.rfoot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.muted {
  color: var(--muted);
}
.cap {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>

<style>
/* the browser's dialogs (teleported) */
.bghost {
  position: fixed;
  z-index: 3000;
  padding: 4px 10px;
  border: 1px solid var(--accent);
  border-radius: var(--r2);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text-hi);
  font-size: 12px;
  pointer-events: none;
}
.bq-back {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.55);
}
.bq {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(440px, calc(100vw - 32px));
  max-height: 80vh;
  overflow: auto;
  padding: 14px 16px 16px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  box-shadow: var(--shadow), inset 0 2px 0 var(--accent);
}
.bq.wide {
  width: min(760px, calc(100vw - 32px));
}
/* the history */
.bq.hist {
  width: min(820px, calc(100vw - 32px));
  height: 80vh;
  padding: 0;
  gap: 0;
  overflow: hidden;
}
.bq.hist .hh {
  gap: 12px;
  height: 46px;
  padding: 0 8px 0 16px;
  white-space: nowrap;
}
.hsw {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 6px;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}
.hsw input {
  display: none;
}
.hsw i {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--panel-3);
  transition: background 0.15s;
}
.hsw i::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-2);
  transition: transform 0.15s;
}
.hsw input:checked + i {
  background: var(--accent);
}
.hsw input:checked + i::after {
  transform: translateX(12px);
  background: #fff;
}
.hclr {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.hclr:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.hclr:disabled {
  opacity: 0.4;
}
.hsearch {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin: 12px 16px 4px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--bg);
  color: var(--muted);
}
.hsearch:focus-within {
  border-color: rgb(var(--accent-rgb) / 0.6);
}
.hsearch input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  outline: none;
}
.hsearch .muted {
  font-family: var(--font-data);
  font-size: 11.5px;
}
.hoff {
  flex: none;
  margin: 8px 16px 0;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: rgba(255, 179, 0, 0.1);
  color: var(--text-2);
  font-size: 12px;
}
.hlist {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 8px 16px;
}
.hday {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 6px 6px 0 6px;
  background: var(--panel);
  color: var(--text-hi);
  font-size: 12.5px;
  font-weight: 600;
}
.hdt::first-letter {
  text-transform: uppercase;
}
.hday .muted {
  font-family: var(--font-data);
  font-size: 11px;
  font-weight: 400;
}
.hrow {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) minmax(0, max-content) 24px;
  align-items: center;
  gap: 12px;
  height: 32px;
  padding: 0 6px;
  border-radius: var(--r2);
  cursor: pointer;
}
.hrow:hover {
  background: rgba(255, 255, 255, 0.06);
}
.htm {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.htt {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hurl {
  max-width: 240px;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hdel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  opacity: 0;
}
.hday .hdel {
  margin-left: auto;
}
.hrow:hover .hdel,
.hday:hover .hdel {
  opacity: 1;
}
.hdel:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
.hmore {
  display: block;
  margin: 10px auto;
  padding: 6px 14px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.bq .hempty {
  margin: 24px 6px;
  font-size: 13px;
}
.bq .hfoot {
  flex: none;
  padding: 8px 16px 10px;
  border-top: 1px solid var(--border);
}
.bq.help {
  width: min(820px, calc(100vw - 32px));
  padding: 0;
  gap: 0;
}
.bq .hh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.bq .hb {
  overflow: auto;
  padding: 6px 20px 20px;
}
.bq .ib {
  display: inline-flex;
  padding: 5px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.bq .cap {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.bq .hint {
  margin: 0;
  color: var(--muted);
  font-size: 11.5px;
}
.bq code {
  padding: 0 4px;
  border-radius: var(--r1);
  background: var(--panel-3);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.bq .tqf {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text-2);
  font-size: 12px;
}
.bq .tqc {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 12.5px;
}
.bq .tqb {
  display: flex;
  gap: 8px;
}
.bq .tlist2 {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  font-family: var(--font-data);
  font-size: 12px;
}
.bq .tl2 {
  /* a column with a height limit would squeeze its rows into each other */
  flex: none;
  display: flex;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bq .tl2 b {
  flex: none;
  width: 52px;
  font-size: 11px;
}
.bq .links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
.bq .lk {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  white-space: nowrap;
}
.bq .lk .lv {
  font-family: var(--font-data);
  font-size: 11.5px;
}
.bmpop {
  position: fixed;
  z-index: 1400;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  max-width: 360px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.bmph {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
  color: var(--text-2);
  font-size: 12px;
}
.bmph button {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.bmrow {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  touch-action: none;
}
.bmrow span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bmrow:hover {
  background: var(--hover);
}
.bmrow.dragging,
.bmrow.dropin {
  background: rgb(var(--accent-rgb) / 0.18);
}
.bmrow.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}
.bmrow.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.bmrow .bfi {
  color: var(--warn);
}
.bmrow .bfi0 {
  color: var(--muted);
}
.bmrow .bico {
  width: 14px;
  height: 14px;
}
.bmempty {
  margin: 8px;
  color: var(--muted);
  font-size: 12px;
}
.certpop {
  position: fixed;
  z-index: 1400;
  width: min(560px, calc(100vw - 24px));
  max-height: 75vh;
  overflow-y: auto;
  padding: 14px 16px 16px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  font-size: 12.5px;
}
.certpop .ch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--up-fg);
  font-size: 13.5px;
  font-weight: 600;
}
.certpop .ch.bad,
.certpop .bad {
  color: var(--down-fg);
}
.certpop .cs {
  margin: 14px 0 6px;
  color: var(--text-hi);
  font-weight: 600;
}
.certpop .cr2 {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 10px;
  padding: 2px 0 2px 12px;
}
.certpop .cr2 span {
  color: var(--text-2);
}
.certpop .cr2 b {
  font-weight: 500;
  color: var(--text);
}
.certpop .cr2 b.warn {
  color: var(--warn-fg);
}
.certpop code {
  font-family: var(--font-data);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.certpop .csan {
  padding-left: 12px;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.certpop p {
  margin: 8px 0 0;
  color: var(--text-2);
}
.bq .pws {
  display: flex;
  flex-direction: column;
  max-height: 340px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--r2);
}
.bq .pw {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}
.bq .pw:last-child {
  border-bottom: 0;
}
.bq .pw button {
  display: inline-flex;
  align-items: center;
  padding: 3px 7px;
  font-size: 11.5px;
}
.bq .pws-site {
  width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-hi);
}
.bq .pws-user {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bq .pws-pass {
  min-width: 90px;
}
.bq .grow {
  flex: 1;
}
.bq .lk .muted {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
