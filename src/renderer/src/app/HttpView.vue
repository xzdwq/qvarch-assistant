<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  allRequests,
  buildUrl,
  DEFAULT_HTTP_SETTINGS,
  findNode,
  HTTP_METHODS,
  METHOD_COLOR,
  httpId,
  newFolder,
  newRequest,
  toCurl,
  type HttpDoc,
  type HttpFolder,
  type HttpNode,
  type HttpRequest,
  type HttpRunResult,
} from '@shared/http'
import Icon from '../components/Icon.vue'
import KvEditor from '../components/KvEditor.vue'
import CodeArea from '../components/CodeArea.vue'
import Markdown from '../components/Markdown.vue'
import { HTTP_HELP } from '../lib/httpHelp'
import { placeFloat, useAnchor } from '../lib/floating'

/**
 * HTTP — a small Postman: requests in folders on the left; the open request — method, address, params, headers,
 * auth, the body (JSON / text / form), what runs before it (other requests + a script — e.g. a token into
 * {{token}}) and a script over the answer; the answer below. Everything is kept by itself.
 */
const doc = reactive<HttpDoc>({ v: 1, items: [], vars: [], settings: { ...DEFAULT_HTTP_SETTINGS } })
const loaded = ref(false)
void window.qa.httpLoad().then((d) => {
  doc.items = d.items
  doc.vars = d.vars
  doc.settings = { ...DEFAULT_HTTP_SETTINGS, ...d.settings }
  loaded.value = true
  if (!sel.value || !findNode(doc.items, sel.value)) sel.value = allRequests(doc.items)[0]?.req.id
})
// kept by itself (a moment after the last change)
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  doc,
  () => {
    if (!loaded.value) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void window.qa.httpSave(JSON.parse(JSON.stringify(doc)) as HttpDoc), 400)
  },
  { deep: true },
)
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    void window.qa.httpSave(JSON.parse(JSON.stringify(doc)) as HttpDoc)
  }
})

// ---------- the tree ----------
const SEL_KEY = 'qa.http.sel'
const sel = ref<string | undefined>(localStorage.getItem(SEL_KEY) ?? undefined)
watch(sel, (v) => {
  try {
    if (v) localStorage.setItem(SEL_KEY, v)
  } catch {
    // fine
  }
})
const req = computed(() => {
  const n = sel.value ? findNode(doc.items, sel.value) : undefined
  return n?.type === 'request' ? n : undefined
})
type Row = { node: HttpNode; depth: number; parent: HttpNode[] }
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (list: HttpNode[], depth: number) => {
    for (const n of list) {
      out.push({ node: n, depth, parent: list })
      if (n.type === 'folder' && n.open) walk(n.children, depth + 1)
    }
  }
  walk(doc.items, 0)
  return out
})
/** The list a node lives in. */
function parentOf(id: string, list: HttpNode[] = doc.items): HttpNode[] | undefined {
  for (const n of list) {
    if (n.id === id) return list
    if (n.type === 'folder') {
      const p = parentOf(id, n.children)
      if (p) return p
    }
  }
  return undefined
}
/** Where a new thing goes: into the open folder / the selected one's folder, else the top. */
function targetList(): HttpNode[] {
  const n = sel.value ? findNode(doc.items, sel.value) : undefined
  if (n?.type === 'folder') return n.children
  return (sel.value && parentOf(sel.value)) || doc.items
}
const renaming = ref<string>()
function addRequest(): void {
  const r = newRequest()
  targetList().push(r)
  sel.value = r.id
  renaming.value = r.id
}
function addFolder(): void {
  const f = newFolder()
  targetList().push(f)
  sel.value = f.id
  renaming.value = f.id
}
function remove(n: HttpNode): void {
  const what = n.type === 'folder' ? `папку «${n.name}» со всем, что в ней` : `запрос «${n.name}»`
  if (!confirm(`Удалить ${what}?`)) return
  const p = parentOf(n.id)
  if (!p) return
  p.splice(p.indexOf(n), 1)
  if (sel.value === n.id) sel.value = allRequests(doc.items)[0]?.req.id
}
/** A copy with new ids (a folder — with everything in it). */
function cloneNode<T extends HttpNode>(n: T): T {
  const c = JSON.parse(JSON.stringify(n)) as T
  const fresh = (x: HttpNode) => {
    x.id = httpId()
    if (x.type === 'folder') x.children.forEach(fresh)
  }
  fresh(c)
  return c
}
function duplicate(n: HttpNode): void {
  const p = parentOf(n.id)
  if (!p) return
  const c = cloneNode(n)
  c.name = `${n.name} (копия)`
  p.splice(p.indexOf(n) + 1, 0, c)
  sel.value = c.id
}
function onRowClick(n: HttpNode): void {
  if (n.type === 'folder') n.open = !n.open
  sel.value = n.id
}

// drag & drop: onto a folder — into it; onto a request — before it; onto the empty space — to the top level
const dragId = ref<string>()
const dropOn = ref<string>()
function isInside(id: string, folder: HttpNode): boolean {
  return folder.type === 'folder' && folder.children.some((c) => c.id === id || isInside(id, c))
}
function onDrop(target?: HttpNode): void {
  const id = dragId.value
  dragId.value = undefined
  dropOn.value = undefined
  if (!id || id === target?.id) return
  const n = findNode(doc.items, id)
  if (!n || (target && isInside(target.id, n))) return
  const from = parentOf(id)
  if (!from) return
  from.splice(from.indexOf(n), 1)
  if (!target) doc.items.push(n)
  else if (target.type === 'folder') {
    target.children.push(n)
    target.open = true
  } else {
    const to = parentOf(target.id) ?? doc.items
    to.splice(to.indexOf(target), 0, n)
  }
}

// ---------- the request ----------
type Tab = 'params' | 'headers' | 'auth' | 'body' | 'pre' | 'post'
const tab = ref<Tab>('params')
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'params', label: 'Параметры' },
  { id: 'headers', label: 'Заголовки' },
  { id: 'auth', label: 'Авторизация' },
  { id: 'body', label: 'Тело' },
  { id: 'pre', label: 'Перед запросом' },
  { id: 'post', label: 'Обработка ответа' },
]
const count = (r: HttpRequest, t: Tab) => {
  if (t === 'params') return r.params.filter((x) => x.on && x.key).length
  if (t === 'headers') return r.headers.filter((x) => x.on && x.key).length
  if (t === 'auth') return r.auth.type === 'none' ? 0 : 1
  if (t === 'body') return r.body.mode === 'none' ? 0 : 1
  if (t === 'pre') return r.pre.requests.length + (r.pre.script.trim() ? 1 : 0)
  return r.post.trim() ? 1 : 0
}
const varMap = computed(() => Object.fromEntries(doc.vars.filter((v) => v.on && v.key).map((v) => [v.key, v.value])))
const fullUrl = computed(() => (req.value ? buildUrl(req.value, varMap.value) : ''))
const jsonError = computed(() => {
  const b = req.value?.body
  if (!b || b.mode !== 'json' || !b.text.trim()) return ''
  try {
    JSON.parse(b.text.replace(/"?\{\{\s*[\w.-]+\s*\}\}"?/g, '"x"'))
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
})
function formatJson(): void {
  const b = req.value?.body
  if (!b) return
  try {
    b.text = JSON.stringify(JSON.parse(b.text), null, 2)
  } catch {
    // not JSON (or has {{vars}} outside strings) — left as it is
  }
}
const RAW_TYPES = ['text/plain', 'application/xml', 'text/html', 'text/csv', 'application/javascript', 'application/x-yaml']
/** The requests that can run before this one. */
const preChoices = computed(() => allRequests(doc.items).filter((x) => x.req.id !== req.value?.id && !req.value?.pre.requests.includes(x.req.id)))
const preName = (id: string) => {
  const n = findNode(doc.items, id)
  return n?.type === 'request' ? n.name : '(удалён)'
}
function movePre(i: number, d: number): void {
  const list = req.value?.pre.requests
  if (!list) return
  const j = i + d
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
}

// ---------- run ----------
const results = reactive(new Map<string, HttpRunResult>())
const running = ref(false)
const result = computed(() => (req.value ? results.get(req.value.id) : undefined))
type RTab = 'result' | 'body' | 'headers' | 'log'
const rtab = ref<RTab>('body')
async function run(): Promise<void> {
  const r = req.value
  if (!r || running.value) return
  running.value = true
  try {
    const out = await window.qa.httpRun(JSON.parse(JSON.stringify(r)) as HttpRequest, JSON.parse(JSON.stringify(doc)) as HttpDoc)
    results.set(r.id, out)
    // the variables the scripts set (a token…) come back into the collection
    for (const [k, v] of Object.entries(out.vars)) {
      const row = doc.vars.find((x) => x.key === k)
      if (row) row.value = v
      else doc.vars.splice(Math.max(0, doc.vars.length - 1), 0, { on: true, key: k, value: v })
    }
    rtab.value = out.error && !out.response ? 'log' : out.hasResult ? 'result' : 'body'
  } finally {
    running.value = false
  }
}
function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void run()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
const statusCls = (s: number) => (s >= 500 ? 'e5' : s >= 400 ? 'e4' : s >= 300 ? 's3' : 's2')
const size = (n: number) => (n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1024 / 1024).toFixed(2)} МБ`)
/** The body pretty-printed when it is JSON. */
const prettyBody = computed(() => {
  const b = result.value?.response?.body ?? ''
  try {
    return { text: JSON.stringify(JSON.parse(b), null, 2), json: true }
  } catch {
    return { text: b, json: false }
  }
})
const prettyResult = computed(() => {
  const r = result.value?.result
  return typeof r === 'string' ? r : JSON.stringify(r, null, 2)
})

// ---------- copy ----------
const copyOpen = ref(false)
const copyBtn = ref<HTMLElement>()
const copyStyle = ref<Record<string, string>>({})
useAnchor(copyOpen, copyBtn, () => copyBtn.value && (copyStyle.value = placeFloat(copyBtn.value, 240, false, 0).style))
const copied = ref('')
const COPIES: Array<{ id: string; label: string; get: (r: HttpRequest) => string }> = [
  { id: 'all', label: 'Весь запрос (для вставки)', get: (r) => JSON.stringify({ qvarchHttp: 1, request: r }, null, 2) },
  { id: 'curl', label: 'cURL', get: (r) => toCurl(r, varMap.value, doc.settings) },
  { id: 'url', label: 'Адрес (с параметрами)', get: (r) => buildUrl(r, varMap.value) },
  { id: 'params', label: 'Параметры', get: (r) => r.params.filter((x) => x.key).map((x) => `${x.on ? '' : '# '}${x.key}=${x.value}`).join('\n') },
  { id: 'headers', label: 'Заголовки', get: (r) => r.headers.filter((x) => x.key).map((x) => `${x.on ? '' : '# '}${x.key}: ${x.value}`).join('\n') },
  { id: 'body', label: 'Тело', get: (r) => (r.body.mode === 'json' || r.body.mode === 'raw' ? r.body.text : r.body.rows.filter((x) => x.key).map((x) => `${x.key}=${x.value}`).join('\n')) },
  { id: 'pre', label: 'Скрипт «перед запросом»', get: (r) => r.pre.script },
  { id: 'post', label: 'Скрипт обработки', get: (r) => r.post },
]
async function copy(c: (typeof COPIES)[number]): Promise<void> {
  if (!req.value) return
  await navigator.clipboard.writeText(c.get(req.value))
  copyOpen.value = false
  copied.value = c.label
  setTimeout(() => (copied.value = ''), 1800)
}
/** «Вставить»: a request copied with «Весь запрос» (or a folder of them) becomes a new one here. */
async function paste(): Promise<void> {
  try {
    const t = await navigator.clipboard.readText()
    const v = JSON.parse(t) as { qvarchHttp?: number; request?: HttpRequest }
    if (!v.request || v.request.type !== 'request') throw new Error()
    const r = cloneNode({ ...newRequest(), ...v.request })
    targetList().push(r)
    sel.value = r.id
  } catch {
    alert('В буфере нет запроса — скопируйте его кнопкой «Копировать → Весь запрос»')
  }
}
function onDocDown(e: PointerEvent): void {
  const t = e.target as Node
  if (copyOpen.value && !copyBtn.value?.contains(t) && !(document.querySelector('.hc-pop')?.contains(t) ?? false)) copyOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown, true))

const varsOpen = ref(false)
const setOpen = ref(false)
const helpOpen = ref(false)
/** The method's label in the tree (short) and its colour. */
const short = (m: string) => (m === 'DELETE' ? 'DEL' : m === 'OPTIONS' ? 'OPT' : m === 'QUERY' ? 'QRY' : m)
const mColor = (m: string) => METHOD_COLOR[m as keyof typeof METHOD_COLOR] ?? 'var(--muted)'

// ---------- the side's width (dragged, like the notebook's) ----------
const SIDE_KEY = 'qa.http.side'
const sideW = ref(Math.min(560, Math.max(200, Number(localStorage.getItem(SIDE_KEY)) || 280)))
function dragSide(e: PointerEvent): void {
  e.preventDefault()
  const x0 = e.clientX
  const w0 = sideW.value
  const move = (ev: PointerEvent) => (sideW.value = Math.min(560, Math.max(200, w0 + ev.clientX - x0)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    try {
      localStorage.setItem(SIDE_KEY, String(sideW.value))
    } catch {
      // fine
    }
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
/** «{{имя}}» as text (a mustache inside a mustache would close it). */
const VAR = '{{имя}}'
/** A rename field takes the focus with its text selected. */
const vFocus = { mounted: (el: HTMLInputElement) => (el.focus(), el.select()) }
</script>

<template>
  <div class="hv" :style="{ gridTemplateColumns: `${sideW}px minmax(0, 1fr)` }">
    <!-- the collection -->
    <aside class="tree">
      <div class="tbar">
        <span class="cap">Запросы</span>
        <span class="grow"></span>
        <button title="Новый запрос" @click="addRequest"><Icon name="plus" :size="14" /></button>
        <button title="Новая папка" @click="addFolder"><Icon name="folderPlus" :size="14" /></button>
        <button title="Вставить скопированный запрос" @click="paste"><Icon name="clipboard" :size="14" /></button>
        <button :class="{ on: varsOpen }" title="Переменные {{…}}" @click="(varsOpen = !varsOpen), (setOpen = false)"><b class="vb">{x}</b></button>
        <button :class="{ on: setOpen }" title="Для всех запросов: User-Agent, заголовки, время ожидания" @click="(setOpen = !setOpen), (varsOpen = false)"><Icon name="settings" :size="14" /></button>
      </div>
      <span class="sgrip" title="Ширина панели" @pointerdown="dragSide"></span>
      <div class="rows" @dragover.prevent @drop.self="onDrop()">
        <div
          v-for="r in rows"
          :key="r.node.id"
          class="row"
          :class="{ sel: sel === r.node.id, folder: r.node.type === 'folder', drop: dropOn === r.node.id, dragging: dragId === r.node.id }"
          :style="{ paddingLeft: `${8 + r.depth * 14}px` }"
          draggable="true"
          @dragstart="dragId = r.node.id"
          @dragend="(dragId = undefined), (dropOn = undefined)"
          @dragover.prevent="dropOn = r.node.id"
          @dragleave="dropOn === r.node.id && (dropOn = undefined)"
          @drop.stop="onDrop(r.node)"
          @click="onRowClick(r.node)"
          @dblclick.stop="renaming = r.node.id"
        >
          <template v-if="r.node.type === 'folder'">
            <Icon :name="(r.node as HttpFolder).open ? 'folderOpen' : 'folder'" :size="14" class="fi" />
          </template>
          <b v-else class="mt" :style="{ color: mColor(r.node.method) }">{{ short(r.node.method) }}</b>
          <input v-if="renaming === r.node.id" v-model="r.node.name" class="ren" spellcheck="false" @click.stop @keydown.enter="renaming = undefined" @keydown.esc="renaming = undefined" v-focus @blur="renaming = undefined" />
          <span v-else class="nm">{{ r.node.name }}</span>
          <span class="acts" @click.stop>
            <button title="Переименовать" @click="renaming = r.node.id"><Icon name="pencil" :size="12" /></button>
            <button title="Копия" @click="duplicate(r.node)"><Icon name="copy" :size="12" /></button>
            <button title="Удалить" @click="remove(r.node)"><Icon name="trash" :size="12" /></button>
          </span>
        </div>
        <p v-if="loaded && !rows.length" class="none">Пусто — создайте запрос или папку</p>
      </div>
      <!-- the variables -->
      <div v-if="varsOpen" class="vars">
        <div class="cap vh">Переменные · <span class="muted">{{ VAR }} в адресе, параметрах, заголовках, теле</span></div>
        <KvEditor :rows="doc.vars" key-hint="имя" value-hint="значение" />
      </div>
      <div v-if="setOpen && doc.settings" class="vars">
        <div class="cap vh">Для всех запросов</div>
        <label class="sl">User-Agent <input v-model="doc.settings.userAgent" spellcheck="false" placeholder="Qvarch-HTTP/1.0" /></label>
        <label class="sl">Ждать ответа, с <input v-model.number="doc.settings.timeoutSec" type="number" min="1" max="600" /></label>
        <div class="cap vh">Общие заголовки</div>
        <KvEditor :rows="doc.settings.headers" key-hint="заголовок" />
        <p class="hint">Заголовок, заданный в самом запросе, важнее общего. Переменные {{ VAR }} работают и здесь.</p>
      </div>
      <button class="howto" @click="helpOpen = true"><Icon name="book" :size="14" />Инструкция: скрипты и переменные</button>
    </aside>

    <!-- the request -->
    <section v-if="req" class="main">
      <div class="line">
        <input v-model="req.name" class="rname" spellcheck="false" title="Название запроса" />
        <span class="grow"></span>
        <span v-if="copied" class="copied">Скопировано: {{ copied }}</span>
        <span ref="copyBtn"><button class="ghost" :class="{ on: copyOpen }" @click="copyOpen = !copyOpen"><Icon name="copy" :size="13" />Копировать<Icon name="chevronDown" :size="11" /></button></span>
      </div>
      <div class="send">
        <select v-model="req.method" class="method" :style="{ color: mColor(req.method) }">
          <option v-for="m in HTTP_METHODS" :key="m" :value="m" :style="{ color: mColor(m) }">{{ m }}</option>
        </select>
        <input v-model="req.url" class="url" placeholder="https://… · {{переменная}}" spellcheck="false" @keydown.enter.prevent="run" />
        <button class="primary go" :disabled="running" title="Отправить (Ctrl+Enter)" @click="run">{{ running ? 'Отправляю…' : 'Отправить' }}</button>
      </div>
      <div v-if="fullUrl && fullUrl !== req.url" class="full" :title="fullUrl">→ {{ fullUrl }}</div>

      <div class="tabs">
        <button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}<i v-if="count(req, t.id)">{{ count(req, t.id) }}</i></button>
      </div>
      <div class="pane">
        <KvEditor v-if="tab === 'params'" :rows="req.params" key-hint="параметр" />
        <KvEditor v-else-if="tab === 'headers'" :rows="req.headers" key-hint="заголовок (Content-Type, X-…)" />
        <div v-else-if="tab === 'auth'" class="auth">
          <span class="seg">
            <button :class="{ on: req.auth.type === 'none' }" @click="req.auth.type = 'none'">Нет</button>
            <button :class="{ on: req.auth.type === 'bearer' }" @click="req.auth.type = 'bearer'">Bearer-токен</button>
            <button :class="{ on: req.auth.type === 'basic' }" @click="req.auth.type = 'basic'">Basic</button>
          </span>
          <label v-if="req.auth.type === 'bearer'" class="fl">Токен <input v-model="req.auth.token" placeholder="{{token}}" spellcheck="false" /></label>
          <template v-if="req.auth.type === 'basic'">
            <label class="fl">Логин <input v-model="req.auth.user" spellcheck="false" /></label>
            <label class="fl">Пароль <input v-model="req.auth.pass" type="password" spellcheck="false" /></label>
          </template>
          <p class="hint">Заголовок Authorization добавится сам (если не задан на вкладке «Заголовки»). Токен можно получить запросом «перед запросом» и положить в переменную.</p>
        </div>
        <div v-else-if="tab === 'body'" class="body">
          <div class="brow">
            <span class="seg">
              <button v-for="m in [{ id: 'none', l: 'Нет' }, { id: 'json', l: 'JSON' }, { id: 'raw', l: 'Текст' }, { id: 'urlencoded', l: 'x-www-form-urlencoded' }, { id: 'form', l: 'form-data' }] as const" :key="m.id" :class="{ on: req.body.mode === m.id }" @click="req.body.mode = m.id">{{ m.l }}</button>
            </span>
            <select v-if="req.body.mode === 'raw'" v-model="req.body.rawType" class="rt" title="Content-Type">
              <option v-for="t in RAW_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <span class="grow"></span>
            <span v-if="req.body.mode === 'json'" class="jstate" :class="{ bad: jsonError }">{{ jsonError ? `ошибка: ${jsonError}` : 'JSON верный' }}</span>
            <button v-if="req.body.mode === 'json'" class="ghost" @click="formatJson">Форматировать</button>
          </div>
          <CodeArea v-if="req.body.mode === 'json' || req.body.mode === 'raw'" :key="`${req.id}-${req.body.mode}`" v-model="req.body.text" :lang="req.body.mode === 'json' ? 'json' : 'text'" :min-height="180" />
          <KvEditor v-else-if="req.body.mode !== 'none'" :rows="req.body.rows" key-hint="поле" />
          <p v-else class="hint">Без тела. Для GET и HEAD тело не отправляется.</p>
        </div>
        <div v-else-if="tab === 'pre'" class="pre">
          <div class="cap">Сначала выполнить запросы (по порядку)</div>
          <div v-for="(id, i) in req.pre.requests" :key="id" class="prow">
            <span class="pn">{{ i + 1 }}.</span>
            <button class="pname" @click="sel = id">{{ preName(id) }}</button>
            <button class="ib" title="Выше" :disabled="i === 0" @click="movePre(i, -1)"><Icon name="chevronLeft" :size="12" style="transform: rotate(90deg)" /></button>
            <button class="ib" title="Ниже" :disabled="i === req.pre.requests.length - 1" @click="movePre(i, 1)"><Icon name="chevronRight" :size="12" style="transform: rotate(90deg)" /></button>
            <button class="ib" title="Убрать" @click="req.pre.requests.splice(i, 1)"><Icon name="x" :size="12" /></button>
          </div>
          <select class="padd" :value="''" @change="(($event.target as HTMLSelectElement).value && req.pre.requests.push(($event.target as HTMLSelectElement).value)), (($event.target as HTMLSelectElement).value = '')">
            <option value="">+ добавить запрос…</option>
            <option v-for="x in preChoices" :key="x.req.id" :value="x.req.id">{{ [...x.path, x.req.name].join(' / ') }}</option>
          </select>
          <div class="cap mt2">Скрипт перед запросом</div>
          <CodeArea :key="`${req.id}-pre`" v-model="req.pre.script" lang="js" :min-height="110" />
          <p class="hint"><code>qa.set('имя', значение)</code> — переменная для <code>{{ VAR }}</code>, <code>qa.get('имя')</code>, <code>qa.log(…)</code>, <code>req</code> — этот запрос (только чтение).</p>
        </div>
        <div v-else class="post">
          <CodeArea :key="`${req.id}-post`" v-model="req.post" lang="js" :min-height="170" />
          <p class="hint">
            <code>res.json()</code>, <code>res.body</code>, <code>res.status</code>, <code>res.header('имя')</code>, <code>res.time</code> · <code>qa.set / qa.get / qa.log</code> · что вернёт
            <code>return</code> — покажется во вкладке «Результат». Например: <code>return res.json().items.filter(x =&gt; x.price &gt; 10).length</code>
          </p>
        </div>
      </div>

      <!-- the answer -->
      <div class="resp">
        <div class="rbar">
          <span class="cap">Ответ</span>
          <template v-if="result?.response">
            <b class="st" :class="statusCls(result.response.status)">{{ result.response.status }} {{ result.response.statusText }}</b>
            <span class="meta">{{ result.response.time }} мс · {{ size(result.response.size) }}</span>
          </template>
          <span v-if="result?.error" class="rerr" :title="result.error">{{ result.error }}</span>
          <span class="grow"></span>
          <span v-if="result" class="rtabs">
            <button v-if="result.hasResult" :class="{ on: rtab === 'result' }" @click="rtab = 'result'">Результат</button>
            <button v-if="result.response" :class="{ on: rtab === 'body' }" @click="rtab = 'body'">Тело</button>
            <button v-if="result.response" :class="{ on: rtab === 'headers' }" @click="rtab = 'headers'">Заголовки<i>{{ result.response.headers.length }}</i></button>
            <button :class="{ on: rtab === 'log' }" @click="rtab = 'log'">Журнал<i v-if="result.logs.length + result.chain.length">{{ result.logs.length + result.chain.length }}</i></button>
          </span>
        </div>
        <div class="rbody">
          <p v-if="!result" class="hint">{{ running ? 'Отправляю…' : 'Нажмите «Отправить» или Ctrl+Enter' }}</p>
          <CodeArea v-else-if="rtab === 'result' && result.hasResult" :key="`r${req.id}`" :model-value="prettyResult" lang="json" readonly :min-height="80" />
          <CodeArea v-else-if="rtab === 'body' && result.response" :key="`b${req.id}`" :model-value="prettyBody.text" :lang="prettyBody.json ? 'json' : 'text'" readonly :min-height="80" />
          <div v-else-if="rtab === 'headers' && result.response" class="hdrs">
            <div v-for="[k, v] in result.response.headers" :key="k" class="hr"><b>{{ k }}</b><span>{{ v }}</span></div>
          </div>
          <div v-else class="log">
            <div v-for="(c, i) in result.chain" :key="`c${i}`" class="lc" :class="{ bad: c.error }">
              <b class="mt" :style="{ color: mColor(c.method) }">{{ short(c.method) }}</b><span>{{ c.name }}</span><span class="muted">{{ c.url }}</span>
              <b v-if="c.status" class="st" :class="statusCls(c.status)">{{ c.status }}</b><span v-if="c.time" class="muted">{{ c.time }} мс</span><span v-if="c.error" class="rerr">{{ c.error }}</span>
            </div>
            <div v-for="(l, i) in result.logs" :key="`l${i}`" class="ll">{{ l }}</div>
            <p v-if="result.error" class="rerr">{{ result.error }}</p>
            <p v-if="!result.chain.length && !result.logs.length && !result.error" class="hint">Пусто — qa.log(…) в скриптах пишет сюда</p>
          </div>
        </div>
      </div>
    </section>
    <section v-else class="main empty">
      <p class="hint">Выберите запрос слева или создайте новый</p>
    </section>

    <Teleport to="body">
      <div v-if="helpOpen" class="hc-back" @mousedown.self="helpOpen = false">
        <div class="hc-help">
          <div class="hc-hh"><span class="cap">Инструкция · HTTP</span><button class="ib" title="Закрыть (Esc)" @click="helpOpen = false"><Icon name="x" :size="14" /></button></div>
          <div class="hc-hb" tabindex="-1" @keydown.esc="helpOpen = false"><Markdown :text="HTTP_HELP" /></div>
        </div>
      </div>
      <div v-if="copyOpen && req" class="hc-pop" :style="copyStyle">
        <button v-for="c in COPIES" :key="c.id" @click="copy(c)">{{ c.label }}</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.hv {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}
.grow {
  flex: 1;
}
.hint {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.hint code {
  padding: 0 4px;
  border-radius: var(--r1);
  background: var(--panel-3);
  font-family: var(--font-data);
  font-size: 11.5px;
  color: var(--accent-fg);
}
/* ---------- the tree ---------- */
.tree {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
}
.tbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 38px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border);
}
.tbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.tbar button:hover,
.tbar button.on {
  color: var(--accent-fg);
  background: var(--hover);
}
.vb {
  font-family: var(--font-data);
  font-size: 11px;
}
.rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding-right: 6px;
  border-left: 2px solid transparent;
  white-space: nowrap;
  font-size: 12.5px;
  cursor: default;
  user-select: none;
}
.row:hover {
  background: var(--hover);
}
.row.sel {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}
.row.drop {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.row.dragging {
  opacity: 0.4;
}
.row.folder {
  font-weight: 600;
  color: var(--text-hi);
}
.fi {
  flex: none;
  color: var(--warn);
}
.mt {
  flex: none;
  width: 34px;
  font-family: var(--font-data);
  font-size: 9.5px;
  font-weight: 700;
}
.nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ren {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  font-size: 12.5px;
}
.acts {
  display: none;
  gap: 1px;
}
.row:hover .acts {
  display: inline-flex;
}
.acts button {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.acts button:hover {
  color: var(--text-hi);
}
.none {
  margin: 12px;
  color: var(--muted);
  font-size: 12px;
}
.vars {
  max-height: 45%;
  overflow: auto;
  padding: 8px;
  border-top: 1px solid var(--border);
}
.vh {
  margin-bottom: 6px;
}
.vh .muted {
  text-transform: none;
  letter-spacing: 0;
  font-family: var(--font-ui);
}
/* ---------- the request ---------- */
.main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 10px 14px 12px;
  gap: 8px;
}
.main.empty {
  align-items: center;
  justify-content: center;
}
.line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rname {
  min-width: 200px;
  max-width: 520px;
  flex: 1;
  height: 28px;
  padding: 0 6px;
  border-color: transparent;
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-hi);
}
.rname:hover {
  border-color: var(--border-2);
}
.copied {
  color: var(--up-fg);
  font-size: 12px;
}
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.ghost.on {
  border-color: var(--accent);
}
.send {
  display: flex;
  gap: 6px;
}
.method {
  flex: none;
  width: 104px;
  font-family: var(--font-data);
  font-weight: 700;
}
.url {
  flex: 1;
  min-width: 0;
  font-family: var(--font-data);
  font-size: 13px;
}
.go {
  flex: none;
  min-width: 110px;
}
.full {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.tabs,
.rtabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
}
.rtabs {
  border: 0;
}
.tabs button,
.rtabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
}
.tabs button.on,
.rtabs button.on {
  color: var(--accent-fg);
}
.tabs button.on::after,
.rtabs button.on::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
}
.tabs i,
.rtabs i {
  padding: 0 5px;
  border-radius: var(--r1);
  background: var(--panel-3);
  color: var(--text-2);
  font-style: normal;
  font-family: var(--font-data);
  font-size: 10px;
}
.pane {
  flex: 1 1 45%;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 0;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg button {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.seg button + button {
  border-left: 1px solid var(--border-2);
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.auth,
.body,
.pre,
.post {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fl {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 520px;
  color: var(--text-2);
  font-size: 12.5px;
}
.fl input {
  flex: 1;
  font-family: var(--font-data);
}
.brow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rt {
  height: 26px;
  padding: 0 6px;
  font-size: 12px;
}
.jstate {
  color: var(--up-fg);
  font-size: 11.5px;
}
.jstate.bad {
  color: var(--down-fg);
}
.prow {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
}
.pn {
  width: 18px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.pname {
  padding: 2px 8px;
  border: 0;
  background: transparent;
  color: var(--info-fg);
  font-size: 12.5px;
}
.ib {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.padd {
  align-self: flex-start;
  min-width: 260px;
  height: 28px;
  font-size: 12px;
}
.mt2 {
  margin-top: 8px;
}
/* ---------- the answer ---------- */
.resp {
  flex: 1 1 55%;
  min-height: 160px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--panel);
  overflow: hidden;
}
.rbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 4px 0 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.st {
  padding: 1px 7px;
  border-radius: var(--r2);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.st.s2 {
  background: rgba(0, 230, 118, 0.15);
  color: var(--up-fg);
}
.st.s3 {
  background: rgba(68, 138, 255, 0.15);
  color: var(--info-fg);
}
.st.e4 {
  background: rgba(255, 183, 77, 0.16);
  color: var(--warn-fg);
}
.st.e5 {
  background: rgba(255, 61, 61, 0.16);
  color: var(--down-fg);
}
.meta {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.rerr {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--down-fg);
  font-size: 12px;
}
.rbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
.hdrs .hr {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 10px;
  padding: 3px 4px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-data);
  font-size: 12px;
}
.hdrs b {
  color: var(--info-fg);
  font-weight: 500;
}
.hdrs span {
  overflow-wrap: anywhere;
}
.log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--font-data);
  font-size: 12px;
}
.lc {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-left: 2px solid var(--info);
  background: var(--panel-2);
}
.lc.bad {
  border-left-color: var(--down);
}
.lc .muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ll {
  padding: 2px 6px;
  white-space: pre-wrap;
  color: var(--text-2);
}
/* the side's width */
.sgrip {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  z-index: 3;
  width: 6px;
  cursor: col-resize;
}
.sgrip:hover {
  background: var(--accent-line);
}
.sl {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
.sl input {
  flex: 1;
  min-width: 0;
  height: 26px;
  font-family: var(--font-data);
  font-size: 12px;
}
.howto {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px;
  padding: 8px 10px;
  border: 1px dashed var(--border-3);
  border-radius: var(--r3);
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 12px;
  text-align: left;
}
.howto:hover {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.hc-back {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 6vh;
  background: rgba(0, 0, 0, 0.55);
}
.hc-help {
  display: flex;
  flex-direction: column;
  width: min(820px, calc(100vw - 32px));
  max-height: 86vh;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  box-shadow: var(--shadow), inset 0 2px 0 var(--accent);
}
.hc-hh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.hc-hb {
  overflow: auto;
  padding: 6px 20px 20px;
}
.hc-pop {
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.hc-pop button {
  padding: 6px 10px;
  border: 0;
  background: transparent;
  text-align: left;
  font-size: 12.5px;
}
.hc-pop button:hover {
  background: var(--hover);
}
</style>
