<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { remoteError } from '../../../shared/remoteError'
import { joinFence, splitFence } from '@nb/domain/fence'
import { publishValue } from '@nb/engine'
import { addressOf, BROWSER_MIN_H, browserBody, parseBrowserBody, type NetItem, type NetPage } from '@shared/noteBrowser'
import { isName } from '@nb/domain/blockInfo'
import Icon from '@renderer/components/Icon.vue'

/**
 * A browser in the note: tabs of real pages (the Браузер section's profile — its sign-ins), scrolling with the
 * text. Its addresses and height are kept in the note. «Запросы»: the active tab's requests with their times
 * (a waterfall), the page's DOMContentLoaded / load; with a name — put into the note's context.
 */
interface WebView extends HTMLElement {
  src: string
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  reload(): void
  stop(): void
  isLoading(): boolean
  openDevTools(): void
  getWebContentsId(): number
}
interface Tab {
  key: number
  /** The address it started with (its webview's src — never changed after, or the page would reload). */
  start: string
  url: string
  title: string
  loading: boolean
  error?: string
  wc?: number
  back: boolean
  fwd: boolean
}

const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const info = computed(() => splitFence(props.src).info)
let seq = 0
const first = parseBrowserBody(splitFence(props.src).body)
const tabs = reactive<Tab[]>(first.tabs.map((u) => ({ key: ++seq, start: u, url: u, title: '', loading: false, back: false, fwd: false })))
const active = ref(first.active)
const height = ref(first.height)
const cur = computed(() => tabs[active.value] ?? tabs[0])

// ---------- kept in the note (the addresses, the shown tab, the height) ----------
let mine = props.src
let saveTimer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(saveTimer)
  const run = () => {
    const p = splitFence(mine)
    const src = joinFence(p.fence, p.info, browserBody({ tabs: tabs.map((t) => t.url), active: active.value, height: height.value }))
    if (src === mine) return
    mine = src
    props.onChange?.(src)
  }
  if (now) run()
  else saveTimer = setTimeout(run, 800)
}
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    // changed in the text itself: the tabs follow it
    mine = s
    const b = parseBrowserBody(splitFence(s).body)
    height.value = b.height
    b.tabs.forEach((u, i) => {
      const t = tabs[i]
      if (!t) tabs.push({ key: ++seq, start: u, url: u, title: '', loading: false, back: false, fwd: false })
      else if (t.url !== u) void go(i, u)
    })
    tabs.splice(b.tabs.length)
    active.value = b.active
  },
)
onBeforeUnmount(() => saveTimer && save(true))

// ---------- the webviews ----------
const views = new Map<number, WebView>()
const offs = new Map<number, () => void>()
function bind(t: Tab, el: unknown): void {
  const wv = el as WebView | null
  if (!wv || views.get(t.key) === wv) return
  views.set(t.key, wv)
  const on = <E extends Event>(type: string, fn: (e: E) => void) => {
    wv.addEventListener(type, fn as EventListener)
    return () => wv.removeEventListener(type, fn as EventListener)
  }
  const nav = () => {
    t.back = wv.canGoBack()
    t.fwd = wv.canGoForward()
  }
  const list = [
    on<Event & { url: string }>('did-navigate', (e) => {
      t.url = e.url
      t.error = undefined
      nav()
      save()
    }),
    on<Event & { url: string; isMainFrame: boolean }>('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return
      t.url = e.url
      nav()
      save()
    }),
    on<Event & { title: string }>('page-title-updated', (e) => (t.title = e.title)),
    on('did-start-loading', () => (t.loading = true)),
    on('did-stop-loading', () => ((t.loading = false), nav())),
    on<Event & { errorCode: number; errorDescription: string; isMainFrame: boolean; validatedURL: string }>('did-fail-load', (e) => {
      // -3: aborted (a new address typed) — not an error
      if (e.isMainFrame && e.errorCode !== -3) t.error = `${e.errorDescription || 'Ошибка'} (${e.errorCode}) — ${e.validatedURL}`
    }),
    on('dom-ready', () => {
      const id = wv.getWebContentsId()
      if (t.wc !== id) {
        t.wc = id
        if (netOn.value && cur.value === t) void listen(t)
      }
    }),
  ]
  offs.set(t.key, () => list.forEach((f) => f()))
}
onBeforeUnmount(() => {
  offs.forEach((f) => f())
  if (netFor !== undefined) void window.qa.nbNet(netFor, false).catch(() => undefined)
})
const wv = () => views.get(cur.value.key)
async function go(i: number, url: string): Promise<void> {
  const t = tabs[i]
  const v = t && views.get(t.key)
  if (!t) return
  t.url = url
  t.error = undefined
  try {
    if (v && t.wc !== undefined) await v.loadURL(url)
    else t.start = url
  } catch {
    // did-fail-load tells it
  }
  save()
}

// ---------- the address, the tabs ----------
const addr = ref('')
const editing = ref(false)
watch(
  () => cur.value.url,
  (u) => !editing.value && (addr.value = u === 'about:blank' ? '' : u),
  { immediate: true },
)
function submit(e: Event): void {
  ;(e.target as HTMLInputElement).blur()
  void go(active.value, addressOf(addr.value))
}
function newTab(url = 'about:blank', after = tabs.length - 1): void {
  tabs.splice(after + 1, 0, { key: ++seq, start: url, url, title: '', loading: false, back: false, fwd: false })
  active.value = after + 1
  save()
  if (url === 'about:blank') void nextTick(() => document.querySelector<HTMLInputElement>(`[data-nbb="${props.line}"] .addr`)?.focus())
}
function closeTab(i: number): void {
  if (tabs.length === 1) {
    void go(0, 'about:blank')
    return
  }
  const t = tabs[i]
  offs.get(t.key)?.()
  offs.delete(t.key)
  views.delete(t.key)
  tabs.splice(i, 1)
  if (active.value >= tabs.length || active.value > i) active.value = Math.max(0, active.value - 1)
  save()
}
function pick(i: number): void {
  active.value = i
  save()
}
/** The main process's news of the block's pages: the event → what it changes. */
const NOTE_BROWSER_EVENTS: Record<string, (p: unknown) => void> = {
  // a page opened a new window: a tab of the block, beside its own
  open: (p) => {
    const { id, url } = p as { id: number; url: string }
    const i = tabs.findIndex((t) => t.wc === id)
    if (i >= 0) newTab(url, i)
  },
  // the network of the page watched
  net: (p) => {
    const n = p as { id: number; page: NetPage; items: NetItem[] }
    if (n.id === netFor) {
      net.value = n.items
      page.value = n.page
    }
  },
}
const offOpen = window.qa.onNoteBrowser((type, p) => {
  if (Object.hasOwn(NOTE_BROWSER_EVENTS, type)) NOTE_BROWSER_EVENTS[type](p)
})
onBeforeUnmount(offOpen)
const label = (t: Tab) => t.title || (t.url === 'about:blank' ? 'Новая вкладка' : t.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))

// ---------- the height ----------
function onResize(e: PointerEvent): void {
  const y0 = e.clientY
  const h0 = height.value
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const move = (m: PointerEvent) => (height.value = Math.max(BROWSER_MIN_H, Math.min(2000, h0 + m.clientY - y0)))
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    save(true)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

// ---------- the requests ----------
const netOn = ref(false)
const preserve = ref(false)
const net = ref<NetItem[]>([])
const page = ref<NetPage>({})
const netErr = ref('')
const filter = ref('')
let netFor: number | undefined
async function listen(t: Tab | undefined): Promise<void> {
  netErr.value = ''
  if (netFor !== undefined && netFor !== t?.wc) await window.qa.nbNet(netFor, false).catch(() => undefined)
  netFor = undefined
  net.value = []
  page.value = {}
  if (!t || t.wc === undefined || !netOn.value) return
  try {
    netFor = t.wc
    await window.qa.nbNet(t.wc, true, preserve.value)
  } catch (e) {
    netFor = undefined
    netErr.value = remoteError(e)
  }
}
watch(netOn, (on) => void listen(on ? cur.value : undefined))
watch(
  () => cur.value.key,
  () => netOn.value && void listen(cur.value),
)
watch(preserve, (p) => netFor !== undefined && void window.qa.nbNet(netFor, true, p))
const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return q ? net.value.filter((n) => n.url.toLowerCase().includes(q) || n.type.toLowerCase().includes(q) || String(n.status ?? '').startsWith(q)) : net.value
})
const t0 = computed(() => Math.min(...net.value.map((n) => n.t0)))
const span = computed(() => {
  const ends = net.value.map((n) => n.t0 + (n.ms ?? 0) / 1000)
  const p = page.value
  return Math.max(0.001, Math.max(...ends, p.load ?? 0, p.dcl ?? 0) - t0.value)
})
const total = computed(() => net.value.reduce((s, n) => s + (n.size ?? 0), 0))
const sinceStart = (ts?: number) => (ts && net.value.length ? Math.max(0, ts - t0.value) * 1000 : undefined)
const bar = (n: NetItem) => ({ left: `${((n.t0 - t0.value) / span.value) * 100}%`, width: `${Math.max(0.4, ((n.ms ?? 0) / 1000 / span.value) * 100)}%` })
const mark = (ts?: number) => (ts ? `${((ts - t0.value) / span.value) * 100}%` : undefined)
const ms = (v?: number) => (v === undefined ? '' : v < 1000 ? `${Math.round(v)} мс` : `${(v / 1000).toFixed(2)} с`)
const bytes = (b?: number) => (b === undefined ? '' : b < 1024 ? `${b} Б` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} КБ` : `${(b / 1024 / 1024).toFixed(2)} МБ`)
const nameOf = (u: string) => {
  try {
    const x = new URL(u)
    return (x.pathname.split('/').filter(Boolean).pop() ?? '') + x.search || x.host
  } catch {
    return u
  }
}
function clearNet(): void {
  net.value = []
  if (netFor !== undefined) void window.qa.nbNetClear(netFor)
}
const published = ref(false)
function publish(): void {
  const name = info.value.name
  if (!name || !isName(name)) return
  publishValue(props.path, name, {
    url: cur.value.url,
    title: cur.value.title,
    domContentLoaded: sinceStart(page.value.dcl),
    load: sinceStart(page.value.load),
    requests: net.value.map((n) => ({ method: n.method, url: n.url, type: n.type, status: n.status ?? null, size: n.size ?? null, ms: n.ms ?? null, ...(n.error ? { error: n.error } : {}) })),
  }, 'browser', name)
  published.value = true
  setTimeout(() => (published.value = false), 1500)
}
const openInBrowser = () => cur.value.url.startsWith('http') && window.qa.browserOpen(cur.value.url)
</script>

<template>
  <div class="nbb tw:contain-[inline-size] tw:flex tw:flex-col tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-block-browser tw:rounded-[8px] tw:bg-panel tw:overflow-hidden" :data-nbb="line">
    <div class="tb-tabs tw:flex tw:items-end tw:gap-2 tw:min-w-0 tw:pt-6 tw:pr-8 tw:pb-0 tw:pl-8 tw:overflow-x-auto tw:scrollbar-none">
      <button v-for="(t, i) in tabs" :key="t.key" class="tab tw:group/tab tw:inline-flex tw:flex-[0_1_200px] tw:items-center tw:gap-6 tw:min-w-70 tw:h-28 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-10 tw:border tw:border-transparent tw:[&&]:border-b-0 tw:rounded-[6px_6px_0_0] tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&&]:[&.on]:border-border tw:[&.on]:bg-bg tw:[&.on]:text-text tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: i === active }" :title="t.url" @mousedown.prevent @click="pick(i)" @auxclick.prevent="$event.button === 1 && closeTab(i)">
        <i v-if="t.loading" class="spin tw:w-9 tw:h-9 tw:border-2 tw:border-accent tw:[&&]:border-r-transparent tw:rounded-[50%] tw:animate-[BlockBrowser-spin_0.8s_linear_infinite]"></i><Icon v-else name="globe" :size="11" />
        <span class="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-left tw:text-ellipsis tw:whitespace-nowrap">{{ label(t) }}</span>
        <b class="tw:inline-flex tw:p-2 tw:rounded-[4px] tw:opacity-0 tw:group-hover/tab:not-group-[.on]/tab:opacity-100 tw:group-[.on]/tab:opacity-100 tw:hover:bg-hover" title="Закрыть вкладку" @click.stop="closeTab(i)"><Icon name="x" :size="10" /></b>
      </button>
      <button class="nt tw:flex-none tw:w-26 tw:h-26 tw:mb-1 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Новая вкладка" @mousedown.prevent @click="newTab()"><Icon name="plus" :size="12" /></button>
    </div>
    <div class="tb-nav tw:flex tw:items-center tw:gap-4 tw:py-5 tw:px-8 tw:border-t tw:border-t-border tw:bg-bg">
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-5 tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:disabled:opacity-35" :disabled="!cur.back" title="Назад" @mousedown.prevent @click="wv()?.goBack()"><Icon name="chevronLeft" :size="14" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-5 tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:disabled:opacity-35" :disabled="!cur.fwd" title="Вперёд" @mousedown.prevent @click="wv()?.goForward()"><Icon name="chevronRight" :size="14" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-5 tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:disabled:opacity-35" v-if="cur.loading" title="Остановить" @mousedown.prevent @click="wv()?.stop()"><Icon name="x" :size="13" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-5 tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:disabled:opacity-35" v-else title="Обновить" @mousedown.prevent @click="wv()?.reload()"><Icon name="refresh" :size="13" /></button>
      <input v-model="addr" class="addr tw:flex-1 tw:min-w-0 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[14px] tw:bg-panel tw:text-text tw:text-[12.5px]" spellcheck="false" placeholder="Адрес или поиск" @focus="(editing = true), ($event.target as HTMLInputElement).select()" @blur="editing = false" @keydown.enter.prevent="submit" @keydown.esc.prevent="(addr = cur.url === 'about:blank' ? '' : cur.url), ($event.target as HTMLInputElement).blur()" />
      <button class="tx tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-5 tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:disabled:opacity-35 tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg" :class="{ on: netOn }" title="Запросы страницы: время каждого, размер, водопад; DOMContentLoaded и load" @mousedown.prevent @click="netOn = !netOn"><Icon name="timeline" :size="13" />Запросы</button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-5 tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:disabled:opacity-35" title="Инструменты разработчика" @mousedown.prevent @click="wv()?.openDevTools()"><Icon name="code" :size="13" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-5 tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:disabled:opacity-35" title="Открыть в разделе «Браузер»" @mousedown.prevent @click="openInBrowser"><Icon name="external" :size="13" /></button>
    </div>
    <div class="stage tw:relative tw:bg-white" :style="{ height: `${height}px` }">
      <webview class="tw:absolute tw:inset-0 tw:w-full tw:h-full tw:[&.off]:invisible tw:[&.off]:pointer-events-none"
        v-for="(t, i) in tabs"
        :key="t.key"
        :ref="(el: unknown) => bind(t, el)"
        :class="{ off: i !== active }"
        :src="t.start"
        partition="persist:qa-browser"
        allowpopups
        webpreferences="contextIsolation=yes, sandbox=yes"
      ></webview>
      <div v-if="cur.error" class="err tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:p-20 tw:bg-bg tw:text-muted tw:text-[13px] tw:text-center"><Icon name="globe" :size="22" /><p>{{ cur.error }}</p><button class="tw:h-28 tw:py-0 tw:px-12 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text" @mousedown.prevent @click="wv()?.reload()">Повторить</button></div>
    </div>
    <div class="rz tw:h-6 tw:border-t tw:border-t-border tw:bg-bg tw:cursor-ns-resize tw:hover:bg-accent/35" title="Потяните — высота" @pointerdown.prevent="onResize"></div>

    <div v-if="netOn" class="net tw:flex tw:flex-col tw:border-t tw:border-t-border">
      <div class="net-h tw:overflow-hidden tw:flex tw:items-center tw:gap-12 tw:min-w-0 tw:py-6 tw:px-10 tw:text-[12px] tw:whitespace-nowrap">
        <span><b>{{ net.length }}</b> запр. · {{ bytes(total) }}</span>
        <span v-if="page.dcl" class="dcl tw:text-timing-dcl">DOMContentLoaded {{ ms(sinceStart(page.dcl)) }}</span>
        <span v-if="page.load" class="ld tw:text-timing-load">load {{ ms(sinceStart(page.load)) }}</span>
        <span class="grow tw:flex-1"></span>
        <input v-model="filter" class="flt tw:flex-[0_1_200px] tw:w-200 tw:min-w-60 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:text-[12px]" spellcheck="false" placeholder="Фильтр: адрес, тип, статус" />
        <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-muted" title="Не очищать список при переходе на другую страницу"><input v-model="preserve" type="checkbox" />сохранять</label>
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:text-[12px] tw:hover:bg-hover" title="Очистить" @mousedown.prevent @click="clearNet"><Icon name="trash" :size="12" /></button>
        <button v-if="info.name" class="pub tw:inline-flex tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-[12px] tw:hover:bg-hover tw:text-accent-fg tw:font-data" :title="`Положить адрес, время загрузки и запросы в контекст заметки: {{ ${info.name}.requests }}`" @mousedown.prevent @click="publish"><Icon :name="published ? 'check' : 'braces'" :size="12" />{{ '{' }}{{ '{' }}{{ info.name }}{{ '}' }}{{ '}' }}</button>
      </div>
      <p v-if="netErr" class="neterr tw:mt-0 tw:mr-10 tw:mb-6 tw:ml-10 tw:text-down-fg tw:text-[12px]">{{ netErr }}</p>
      <div class="net-l tw:max-h-320 tw:overflow-auto tw:font-data tw:text-[11.5px]">
        <div v-for="n in shown" :key="n.id" class="nr tw:group/nr tw:grid tw:grid-cols-[40px_52px_minmax(120px,2fr)_76px_64px_64px_minmax(120px,2fr)] tw:items-center tw:gap-8 tw:h-22 tw:py-0 tw:px-10 tw:border-t tw:border-t-border tw:whitespace-nowrap tw:hover:bg-hover tw:[&.run]:text-muted" :class="{ bad: n.error || (n.status ?? 0) >= 400, run: !n.done }" :title="`${n.method} ${n.url}${n.error ? `\n${n.error}` : ''}`">
          <span class="st tw:overflow-hidden tw:text-ellipsis tw:group-[.bad]/nr:text-down-fg">{{ n.error ? '✕' : (n.status ?? '…') }}</span>
          <span class="me tw:overflow-hidden tw:text-ellipsis tw:text-muted">{{ n.method }}</span>
          <span class="nm tw:overflow-hidden tw:text-ellipsis tw:group-[.bad]/nr:text-down-fg">{{ nameOf(n.url) }}</span>
          <span class="ty tw:overflow-hidden tw:text-ellipsis tw:text-muted">{{ n.type }}</span>
          <span class="sz tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-right">{{ n.fromCache ? 'кэш' : bytes(n.size) }}</span>
          <span class="tm tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-right">{{ ms(n.ms) }}</span>
          <span class="wf tw:overflow-hidden tw:text-ellipsis tw:relative tw:h-10"><i class="tw:absolute tw:top-2 tw:h-6 tw:min-w-2 tw:rounded-[2px] tw:bg-timing-request tw:group-[.bad]/nr:not-group-[.run]/nr:bg-down tw:group-[.run]/nr:bg-muted" :style="bar(n)"></i><em v-if="mark(page.dcl)" class="d tw:absolute tw:-top-6 tw:-bottom-6 tw:w-1 tw:bg-timing-dcl" :style="{ left: mark(page.dcl) }"></em><em v-if="mark(page.load)" class="l tw:absolute tw:-top-6 tw:-bottom-6 tw:w-1 tw:bg-timing-load" :style="{ left: mark(page.load) }"></em></span>
        </div>
        <p v-if="!shown.length" class="muted tw:my-8 tw:mx-10 tw:text-muted tw:[font-family:var(--font-ui,inherit)] tw:text-[12px]">{{ net.length ? 'Ничего не подходит' : 'Пока пусто — обновите страницу или перейдите по ссылке' }}</p>
      </div>
    </div>
  </div>
</template>
