<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { fenceParts, fenceSrc, publishValue } from '../../lib/runbook'
import { addressOf, BROWSER_MIN_H, browserBody, parseBrowserBody, type NetItem, type NetPage } from '@shared/noteBrowser'
import { isName } from '@shared/runbook'
import Icon from '../Icon.vue'

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
const info = computed(() => fenceParts(props.src).info)
let seq = 0
const first = parseBrowserBody(fenceParts(props.src).body)
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
    const p = fenceParts(mine)
    const src = fenceSrc(p.fence, p.info, browserBody({ tabs: tabs.map((t) => t.url), active: active.value, height: height.value }))
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
    const b = parseBrowserBody(fenceParts(s).body)
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
const offOpen = window.qa.onNoteBrowser((type, p) => {
  if (type === 'open') {
    const { id, url } = p as { id: number; url: string }
    const i = tabs.findIndex((t) => t.wc === id)
    if (i >= 0) newTab(url, i)
  } else if (type === 'net') {
    const n = p as { id: number; page: NetPage; items: NetItem[] }
    if (n.id === netFor) {
      net.value = n.items
      page.value = n.page
    }
  }
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
    netErr.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
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
  <div class="nbb" :data-nbb="line">
    <div class="tb-tabs">
      <button v-for="(t, i) in tabs" :key="t.key" class="tab" :class="{ on: i === active }" :title="t.url" @mousedown.prevent @click="pick(i)" @auxclick.prevent="$event.button === 1 && closeTab(i)">
        <i v-if="t.loading" class="spin"></i><Icon v-else name="globe" :size="11" />
        <span>{{ label(t) }}</span>
        <b title="Закрыть вкладку" @click.stop="closeTab(i)"><Icon name="x" :size="10" /></b>
      </button>
      <button class="nt" title="Новая вкладка" @mousedown.prevent @click="newTab()"><Icon name="plus" :size="12" /></button>
    </div>
    <div class="tb-nav">
      <button :disabled="!cur.back" title="Назад" @mousedown.prevent @click="wv()?.goBack()"><Icon name="chevronLeft" :size="14" /></button>
      <button :disabled="!cur.fwd" title="Вперёд" @mousedown.prevent @click="wv()?.goForward()"><Icon name="chevronRight" :size="14" /></button>
      <button v-if="cur.loading" title="Остановить" @mousedown.prevent @click="wv()?.stop()"><Icon name="x" :size="13" /></button>
      <button v-else title="Обновить" @mousedown.prevent @click="wv()?.reload()"><Icon name="refresh" :size="13" /></button>
      <input v-model="addr" class="addr" spellcheck="false" placeholder="Адрес или поиск" @focus="(editing = true), ($event.target as HTMLInputElement).select()" @blur="editing = false" @keydown.enter.prevent="submit" @keydown.esc.prevent="(addr = cur.url === 'about:blank' ? '' : cur.url), ($event.target as HTMLInputElement).blur()" />
      <button class="tx" :class="{ on: netOn }" title="Запросы страницы: время каждого, размер, водопад; DOMContentLoaded и load" @mousedown.prevent @click="netOn = !netOn"><Icon name="timeline" :size="13" />Запросы</button>
      <button title="Инструменты разработчика" @mousedown.prevent @click="wv()?.openDevTools()"><Icon name="code" :size="13" /></button>
      <button title="Открыть в разделе «Браузер»" @mousedown.prevent @click="openInBrowser"><Icon name="external" :size="13" /></button>
    </div>
    <div class="stage" :style="{ height: `${height}px` }">
      <webview
        v-for="(t, i) in tabs"
        :key="t.key"
        :ref="(el: unknown) => bind(t, el)"
        :class="{ off: i !== active }"
        :src="t.start"
        partition="persist:qa-browser"
        allowpopups
        webpreferences="contextIsolation=yes, sandbox=yes"
      ></webview>
      <div v-if="cur.error" class="err"><Icon name="globe" :size="22" /><p>{{ cur.error }}</p><button @mousedown.prevent @click="wv()?.reload()">Повторить</button></div>
    </div>
    <div class="rz" title="Потяните — высота" @pointerdown.prevent="onResize"></div>

    <div v-if="netOn" class="net">
      <div class="net-h">
        <span><b>{{ net.length }}</b> запр. · {{ bytes(total) }}</span>
        <span v-if="page.dcl" class="dcl">DOMContentLoaded {{ ms(sinceStart(page.dcl)) }}</span>
        <span v-if="page.load" class="ld">load {{ ms(sinceStart(page.load)) }}</span>
        <span class="grow"></span>
        <input v-model="filter" class="flt" spellcheck="false" placeholder="Фильтр: адрес, тип, статус" />
        <label class="chk" title="Не очищать список при переходе на другую страницу"><input v-model="preserve" type="checkbox" />сохранять</label>
        <button title="Очистить" @mousedown.prevent @click="clearNet"><Icon name="trash" :size="12" /></button>
        <button v-if="info.name" class="pub" :title="`Положить адрес, время загрузки и запросы в контекст заметки: {{ ${info.name}.requests }}`" @mousedown.prevent @click="publish"><Icon :name="published ? 'check' : 'braces'" :size="12" />{{ '{' }}{{ '{' }}{{ info.name }}{{ '}' }}{{ '}' }}</button>
      </div>
      <p v-if="netErr" class="neterr">{{ netErr }}</p>
      <div class="net-l">
        <div v-for="n in shown" :key="n.id" class="nr" :class="{ bad: n.error || (n.status ?? 0) >= 400, run: !n.done }" :title="`${n.method} ${n.url}${n.error ? `\n${n.error}` : ''}`">
          <span class="st">{{ n.error ? '✕' : (n.status ?? '…') }}</span>
          <span class="me">{{ n.method }}</span>
          <span class="nm">{{ nameOf(n.url) }}</span>
          <span class="ty">{{ n.type }}</span>
          <span class="sz">{{ n.fromCache ? 'кэш' : bytes(n.size) }}</span>
          <span class="tm">{{ ms(n.ms) }}</span>
          <span class="wf"><i :style="bar(n)"></i><em v-if="mark(page.dcl)" class="d" :style="{ left: mark(page.dcl) }"></em><em v-if="mark(page.load)" class="l" :style="{ left: mark(page.load) }"></em></span>
        </div>
        <p v-if="!shown.length" class="muted">{{ net.length ? 'Ничего не подходит' : 'Пока пусто — обновите страницу или перейдите по ссылке' }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nbb {
  /* as wide as the note — never wider because of what is inside */
  contain: inline-size;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-left: 3px solid #60a5fa;
  border-radius: 8px;
  background: var(--panel);
  overflow: hidden;
}
.tb-tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
  padding: 6px 8px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  display: inline-flex;
  flex: 0 1 200px;
  align-items: center;
  gap: 6px;
  min-width: 70px;
  height: 28px;
  padding: 0 6px 0 10px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.tab span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab.on {
  border-color: var(--border);
  background: var(--bg);
  color: var(--text);
}
.tab b {
  display: inline-flex;
  padding: 2px;
  border-radius: 4px;
  opacity: 0;
}
.tab:hover b,
.tab.on b {
  opacity: 1;
}
.tab b:hover {
  background: var(--hover);
}
.nt {
  flex: none;
  width: 26px;
  height: 26px;
  margin-bottom: 1px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.tb-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.tb-nav button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.tb-nav button:hover:not(:disabled) {
  background: var(--hover);
}
.tb-nav button:disabled {
  opacity: 0.35;
}
.tb-nav button.on {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--accent-fg);
}
.addr {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 14px;
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
}
.stage {
  position: relative;
  background: #fff;
}
.stage webview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.stage webview.off {
  visibility: hidden;
  pointer-events: none;
}
.err {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  background: var(--bg);
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.err button {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
}
.rz {
  height: 6px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  cursor: ns-resize;
}
.rz:hover {
  background: rgb(var(--accent-rgb) / 0.35);
}
.net {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
}
.net-h {
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 6px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.dcl {
  color: #60a5fa;
}
.ld {
  color: #f87171;
}
.grow {
  flex: 1;
}
.flt {
  flex: 0 1 200px;
  width: 200px;
  min-width: 60px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
}
.net-h button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.net-h button:hover {
  background: var(--hover);
}
.net-h .pub {
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.neterr {
  margin: 0 10px 6px;
  color: var(--down-fg);
  font-size: 12px;
}
.net-l {
  max-height: 320px;
  overflow: auto;
  font-family: var(--font-data);
  font-size: 11.5px;
}
.nr {
  display: grid;
  grid-template-columns: 40px 52px minmax(120px, 2fr) 76px 64px 64px minmax(120px, 2fr);
  align-items: center;
  gap: 8px;
  height: 22px;
  padding: 0 10px;
  border-top: 1px solid var(--border);
  white-space: nowrap;
}
.nr:hover {
  background: var(--hover);
}
.nr > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.nr.bad .st,
.nr.bad .nm {
  color: var(--down-fg);
}
.nr.run {
  color: var(--muted);
}
.me,
.ty,
.sz,
.tm {
  color: var(--muted);
}
.sz,
.tm {
  text-align: right;
}
.wf {
  position: relative;
  height: 10px;
}
.wf i {
  position: absolute;
  top: 2px;
  height: 6px;
  min-width: 2px;
  border-radius: 2px;
  background: #34d399;
}
.nr.bad .wf i {
  background: var(--down);
}
.nr.run .wf i {
  background: var(--muted);
}
.wf em {
  position: absolute;
  top: -6px;
  bottom: -6px;
  width: 1px;
}
.wf em.d {
  background: #60a5fa;
}
.wf em.l {
  background: #f87171;
}
.muted {
  margin: 8px 10px;
  color: var(--muted);
  font-family: var(--font-ui, inherit);
  font-size: 12px;
}
.spin {
  width: 9px;
  height: 9px;
  border: 2px solid var(--accent);
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
