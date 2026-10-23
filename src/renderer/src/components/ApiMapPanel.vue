<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { apiMapMd, avgMs, compareSpec, errCount, fieldLine, searchMatch, searchText, searchWords, statusLine, type ApiEndpoint, type ApiSample, type Shape } from '@shared/apiMap'
import type { ApiOp } from '@shared/openapi'
import { apiMapHosts, apiMapTick, checkState } from '../lib/browser'
import { openNote } from '../lib/mentions'
import Icon from './Icon.vue'
import NotePicker from './NotePicker.vue'
import SwaggerOps from './SwaggerOps.vue'
import { httpRequestText, type HttpExample } from '@shared/httpBlock'
import type { ApiSpec } from '@shared/openapi'
import { appendToNote, authFor, blocksOf } from '../lib/apiCopy'

/**
 * «Карта API»: what the site's pages call, from the traffic «Проверка» watches — the endpoints of a site, each
 * opened: its answers, its time, its pages, the fields sent and answered, a request and an answer to look at. The
 * site's Swagger (found on the page — its own view «Swagger»): what is not in it, what in it was never called; its
 * operations carried into HTTP / the notebook / the clipboard as the traffic's are. The whole map → a note.
 */
const props = defineProps<{
  url?: string
  swagger?: { title: string; ops: ApiOp[]; base: string; host: string }
  /** The Swagger found (its description, its address), the search going on, what went wrong, what was tried. */
  api?: { url: string; spec: unknown; info: ApiSpec }
  apiBusy?: boolean
  apiError?: string
  apiTried?: string[]
  /** A page is open (the search has something to look at). */
  canFind?: boolean
}>()
const emit = defineEmits<{ findSwagger: []; clearSwagger: []; swaggerToHttp: [ids: string[]] }>()
/** What the panel shows: the traffic's map, or the site's Swagger. */
const view = ref<'traffic' | 'swagger'>('traffic')
const onlyNotCalled = ref(false)
// a Swagger just found — shown
watch(
  () => props.api?.url,
  (u) => u && (view.value = 'swagger'),
)

const hostOf = (u?: string) => {
  try {
    return u ? new URL(u).host : ''
  } catch {
    return ''
  }
}
// ---------- the site ----------
const host = ref('')
/** The tab's site (an http page's). */
const tabHost = computed(() => (/^https?:/i.test(props.url ?? '') ? hostOf(props.url) : ''))
// the tab's site — another tab, another page: its map (empty yet — said so, not another site's map shown)
watch(
  tabHost,
  (h) => {
    if (h) host.value = h
    else if (!apiMapHosts.value.some((x) => x.host === host.value)) host.value = apiMapHosts.value[0]?.host ?? ''
  },
  { immediate: true },
)
/** The sites to choose from: the map's, and the tab's when it has nothing there yet. */
const hostOptions = computed(() => {
  const l = apiMapHosts.value.map((h) => ({ host: h.host, n: h.endpoints }))
  if (tabHost.value && !l.some((x) => x.host === tabHost.value)) l.unshift({ host: tabHost.value, n: 0 })
  return l
})
const list = shallowRef<ApiEndpoint[]>([])
let busy = false
async function load(): Promise<void> {
  if (busy) return
  busy = true
  try {
    const next = host.value ? await window.qa.browser('apiMapList', host.value) : []
    const sig = (l: ApiEndpoint[]) => l.map((e) => `${e.key}|${e.count}|${e.last}`).join('\n')
    if (sig(next) !== sig(list.value)) list.value = next
  } finally {
    busy = false
  }
}
watch(host, load, { immediate: true })
// news of the map: the list read again at most every 3 s (a page sends dozens of requests a second; the list is big)
let tickTimer: ReturnType<typeof setTimeout> | undefined
watch(apiMapTick, () => (tickTimer ??= setTimeout(() => ((tickTimer = undefined), void load()), 3000)))
onBeforeUnmount(() => clearTimeout(tickTimer))

// ---------- the Swagger beside it (the same site only) ----------
const spec = computed(() => (props.swagger && props.swagger.host === host.value ? props.swagger : undefined))
const cmp = computed(() => (spec.value ? compareSpec(list.value, spec.value.ops, spec.value.base) : undefined))
const notCalledIds = computed(() => (cmp.value ? new Set(cmp.value.notCalled.map((o) => o.id)) : undefined))

// ---------- what is shown ----------
type Flt = '' | 'err' | 'nospec' | 'write'
const flt = ref<Flt>('')
/** The search as typed (the field), and as searched — a moment after the typing stops. */
const qIn = ref('')
const q = ref('')
let qTimer: ReturnType<typeof setTimeout> | undefined
watch(qIn, (v) => {
  clearTimeout(qTimer)
  qTimer = setTimeout(() => (q.value = v), 150)
})
const hay = new WeakMap<ApiEndpoint, string>()
const hayOf = (e: ApiEndpoint) => {
  let h = hay.get(e)
  if (h === undefined) hay.set(e, (h = searchText(e, cmp.value?.byKey[e.key]?.summary)))
  return h
}
type Sort = 'path' | 'count' | 'ms' | 'last'
const sort = ref<Sort>('path')
const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'path', label: 'по пути' },
  { id: 'count', label: 'по вызовам' },
  { id: 'ms', label: 'по времени' },
  { id: 'last', label: 'последние' },
]
const shown = computed(() => {
  // every word found (an address pasted whole — by its path, its ids as :id)
  const words = searchWords(q.value)
  const out = list.value.filter(
    (e) =>
      (!words.length || searchMatch(hayOf(e), words)) &&
      (flt.value !== 'err' || errCount(e) > 0) &&
      (flt.value !== 'write' || e.method !== 'GET') &&
      (flt.value !== 'nospec' || (cmp.value && !cmp.value.byKey[e.key])),
  )
  const by: Record<Sort, (a: ApiEndpoint, b: ApiEndpoint) => number> = {
    path: (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    count: (a, b) => b.count - a.count,
    ms: (a, b) => avgMs(b) - avgMs(a),
    last: (a, b) => b.last - a.last,
  }
  return out.sort(by[sort.value])
})
const nErr = computed(() => list.value.filter((e) => errCount(e) > 0).length)
const nWrite = computed(() => list.value.filter((e) => e.method !== 'GET').length)
const nNoSpec = computed(() => (cmp.value ? list.value.filter((e) => !cmp.value!.byKey[e.key]).length : 0))

// ---------- picked (for a note of their own) ----------
const picked = ref(new Set<string>())
watch(host, () => (picked.value = new Set()))
function pick(k: string): void {
  const p = new Set(picked.value)
  if (p.has(k)) p.delete(k)
  else p.add(k)
  picked.value = p
}
const allShownPicked = computed(() => shown.value.length > 0 && shown.value.every((e) => picked.value.has(e.key)))
function pickShown(): void {
  const p = new Set(picked.value)
  if (allShownPicked.value) for (const e of shown.value) p.delete(e.key)
  else for (const e of shown.value) p.add(e.key)
  picked.value = p
}

// ---------- one opened ----------
const open = ref<string>()
const tab = ref<'res' | 'req' | 'hd' | 'ex'>('res')
/** The calls kept (the last good one, the last failed one) — their headers, their example. */
const samplesOf = (e: ApiEndpoint) => [e.sample, e.errSample].filter((s): s is ApiSample => !!s)
const rowsOf = (sh: Shape) => Object.entries(sh.fields).map(([p, f]) => ({ p, ...fieldLine(f, sh.bodies), ex: f.ex }))
const depth = (p: string) => (p.match(/\.|\[\]/g) ?? []).length
const ms = (n: number) => (n < 1000 ? `${n} мс` : `${(n / 1000).toFixed(1)} с`)
const ago = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const copied = ref('')
async function copy(text: string, what: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  copied.value = what
  setTimeout(() => copied.value === what && (copied.value = ''), 1500)
}
/** An endpoint's example as a request (none — never answered with a body kept). */
const exampleOf = (e: ApiEndpoint): HttpExample | undefined => {
  const s = e.sample ?? e.errSample
  return s ? { method: e.method, url: s.url, body: s.reqBody, contentType: s.contentType } : undefined
}
const asHttp = (e: ApiEndpoint) => (exampleOf(e) ? httpRequestText(exampleOf(e)!) : '')
/** One endpoint's request — with the site's login — to the clipboard. */
async function copyOne(e: ApiEndpoint): Promise<void> {
  const x = exampleOf(e)
  if (!x) return
  await copy(httpRequestText(x, (await authFor([x.url]))(x.url)), e.key)
}
const pickedExamples = () => list.value.filter((e) => picked.value.has(e.key)).map(exampleOf).filter((x): x is HttpExample => !!x)
/** The picked requests as ready ```http blocks of the notebook — to paste into any note. */
async function copyPicked(): Promise<void> {
  const xs = pickedExamples()
  if (!xs.length) return
  await copy(await blocksOf(xs), 'picked')
}
/** The picked requests at the end of a note there is (only the requests; their names free in it). */
async function toExisting(path: string): Promise<void> {
  mdErr.value = ''
  try {
    const xs = pickedExamples()
    if (!xs.length) return
    await appendToNote(path, xs)
    picked.value = new Set()
    made.value = { path, name: path.split('/').pop()!.replace(/\.md$/, '') }
    void openNote(path)
  } catch (err) {
    mdErr.value = err instanceof Error ? err.message : String(err)
  }
}
const onPickNote = (path: string | null) => void (path ? toExisting(path) : toNote(true))

// ---------- a note: the whole map (the site's note written anew) or the picked ones (a new note each time) ----------
const made = ref<{ path: string; name: string }>()
const mdErr = ref('')
const safe = (s: string) => s.replace(/[:/\\?*"<>|]/g, '_')
async function toNote(onlyPicked = false): Promise<void> {
  mdErr.value = ''
  try {
    const some = onlyPicked ? list.value.filter((e) => picked.value.has(e.key)) : list.value
    if (!some.length) return
    // (the Swagger's «never called» — news of a whole map, not of a few picked ones)
    const sp = spec.value && cmp.value ? { title: spec.value.title, byKey: cmp.value.byKey, notCalled: onlyPicked ? [] : cmp.value.notCalled } : undefined
    const text = apiMapMd(host.value, some, sp, await authFor(some.map((e) => (e.sample ?? e.errSample)?.url ?? '').filter(Boolean)))
    const dir = 'Карты API'
    const tree = await window.qa.vaultTree()
    if (!tree.some((n) => n.dir && n.path === dir)) await window.qa.vaultCreate('', 'folder', dir)
    const one = some.length === 1 ? `${some[0].method} ${some[0].path.split('/').filter((x) => x && x !== ':id').pop() ?? ''}`.trim() : `методов ${some.length}`
    const name = safe(onlyPicked ? `${host.value} — ${one}` : host.value)
    const want = `${dir}/${name}.md`
    const has =
      !onlyPicked &&
      (await window.qa.vaultRead(want).then(
        () => true,
        () => false,
      ))
    const path = has ? (await window.qa.vaultWrite(want, text), want) : await window.qa.vaultCreate(dir, 'note', name, text)
    if (onlyPicked) picked.value = new Set()
    made.value = { path, name: path.split('/').pop()!.replace(/\.md$/, '') }
    void openNote(path)
  } catch (e) {
    mdErr.value = e instanceof Error ? e.message : String(e)
  }
}
/** «Очистить?» asked: it stays while the cursor is on it, goes 3 s after the cursor leaves. */
const sure = ref(false)
let sureTimer: ReturnType<typeof setTimeout> | undefined
const releaseSure = () => (clearTimeout(sureTimer), (sureTimer = setTimeout(() => (sure.value = false), 3000)))
const holdSure = () => clearTimeout(sureTimer)
onBeforeUnmount(() => clearTimeout(sureTimer))
async function clear(): Promise<void> {
  if (!sure.value) return void ((sure.value = true), releaseSure())
  clearTimeout(sureTimer)
  sure.value = false
  await window.qa.browser('apiMapClear', host.value)
  open.value = undefined
  await load()
}
const setOn = () => window.qa.browser('checkSet', { on: true })
</script>

<template>
  <div class="am">
    <p v-if="!checkState.settings.on" class="am-off">
      <Icon name="map" :size="13" /><span>Карта собирается, пока включено слежение «Проверки». Работайте с сайтом как обычно — сюда попадёт каждый запрос его страниц.</span>
      <button class="primary" @click="setOn">Включить</button>
    </p>
    <div class="am-top">
      <select v-model="host" :disabled="!hostOptions.length" title="Сайт">
        <option v-if="!hostOptions.length" value="">сайтов пока нет</option>
        <option v-for="h in hostOptions" :key="h.host" :value="h.host">{{ h.host }} · {{ h.n }}</option>
      </select>
      <span class="am-seg">
        <button :class="{ on: view === 'traffic' }" title="Запросы, которые делают страницы сайта" @click="view = 'traffic'">Трафик</button>
        <button :class="{ on: view === 'swagger' }" title="Swagger / OpenAPI сайта: найти, перенести в HTTP и в блокнот" @click="((view = 'swagger'), (onlyNotCalled = false))">Swagger<b v-if="api"> {{ api.info.ops.length }}</b></button>
      </span>
      <span class="grow"></span>
      <!-- (the clearing first: its «Очистить?» grows to the left, into the free room — nothing moves under the cursor) -->
      <button v-if="sure && view === 'traffic'" class="sure" title="Карта этого сайта будет очищена" @click="clear" @mouseenter="holdSure" @mouseleave="releaseSure"><Icon name="trash" :size="12" />Очистить?</button>
      <button v-else-if="view === 'traffic'" class="ib" :disabled="!list.length" title="Очистить карту этого сайта" @click="clear"><Icon name="trash" :size="14" /></button>
      <button v-if="view === 'traffic'" class="ib" :disabled="!list.length" title="Вся карта сайта — в заметку (папка «Карты API»): таблица, поля, запросы, которые можно выполнить" @click="toNote()"><Icon name="note" :size="14" /></button>
    </div>
    <p v-if="made" class="am-made"><Icon name="check" :size="12" />Заметка: <a href="#" @click.prevent="openNote(made.path)">{{ made.name }}</a><button class="ib" @click="made = undefined"><Icon name="x" :size="11" /></button></p>
    <p v-if="mdErr" class="am-er">{{ mdErr }}</p>

    <SwaggerOps v-if="view === 'swagger'" :api="api" :busy="!!apiBusy" :error="apiError ?? ''" :tried="apiTried ?? []" :not-called="notCalledIds" :can-find="!!canFind" :only-not-called="onlyNotCalled" @find="emit('findSwagger')" @clear="emit('clearSwagger')" @to-http="(ids) => emit('swaggerToHttp', ids)" @made="(m) => (made = m)" />
    <template v-else>
    <!-- the Swagger beside it -->
    <div v-if="host" class="am-spec">
      <template v-if="spec && cmp">
        <span class="pglyph">{}</span>
        <span class="am-sl">Swagger: в нём {{ list.length - nNoSpec }} из {{ list.length }}</span>
        <button v-if="cmp.notCalled.length" class="lnk" title="Методы Swagger, которые страницы ни разу не вызвали — непроверенное: открыть их список" @click="((onlyNotCalled = true), (view = 'swagger'))">не вызывались: {{ cmp.notCalled.length }}</button>
      </template>
      <template v-else>
        <span class="muted">Swagger не найден — карта только по трафику</span>
        <button class="lnk" title="Поискать Swagger / OpenAPI на этом сайте" @click="((view = 'swagger'), emit('findSwagger'))">найти</button>
      </template>
    </div>

    <div class="am-flt">
      <button :class="{ on: !flt }" @click="flt = ''">Все <b>{{ list.length }}</b></button>
      <button :class="{ on: flt === 'write' }" title="POST / PUT / PATCH / DELETE" @click="flt = flt === 'write' ? '' : 'write'">Мутируют <b>{{ nWrite }}</b></button>
      <button :class="{ on: flt === 'err', bad: nErr }" title="Были ответы 4xx / 5xx или сбои" @click="flt = flt === 'err' ? '' : 'err'">С ошибками <b>{{ nErr }}</b></button>
      <button v-if="cmp" :class="{ on: flt === 'nospec' }" title="Вызываются страницами, но в Swagger их нет" @click="flt = flt === 'nospec' ? '' : 'nospec'">Нет в Swagger <b>{{ nNoSpec }}</b></button>
    </div>
    <div class="am-q">
      <label><Icon name="search" :size="12" /><input v-model="qIn" placeholder="Путь или адрес целиком, поле, код ответа…" title="Можно вставить адрес запроса целиком — id в нём сведутся к :id. Несколько слов — должны найтись все" spellcheck="false" /></label>
      <select v-model="sort" title="Порядок">
        <option v-for="s in SORTS" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
    </div>

    <div v-if="shown.length" class="am-pick">
      <label :title="allShownPicked ? 'Снять отметку с показанных' : 'Отметить все показанные'"><input type="checkbox" :checked="allShownPicked" :indeterminate.prop="!allShownPicked && shown.some((e) => picked.has(e.key))" @change="pickShown" /><span>{{ picked.size ? `Выбрано: ${picked.size}` : 'Выбрать' }}</span></label>
      <template v-if="picked.size">
        <span class="grow"></span>
        <button class="ib" :title="copied === 'picked' ? 'Скопировано' : 'Копировать выбранные как HTTP-блоки (с входом сайта) — вставьте в любую заметку'" @click="copyPicked"><Icon :name="copied === 'picked' ? 'check' : 'copy'" :size="14" /></button>
        <NotePicker class="primary sm" title="Выбранные запросы — новой заметкой (папка «Карты API») или в конец заметки, что есть" new-label="Новая заметка (папка «Карты API»)" @pick="onPickNote" />
      </template>
    </div>
    <div class="am-list">
      <div v-if="!shown.length" class="am-empty">
        <Icon name="map" :size="26" />
        <p v-if="!list.length">{{ host === tabHost && tabHost ? 'Страницы этого сайта ещё не обращались к API (XHR / fetch).' : 'Карта пуста.' }} {{ checkState.settings.on ? 'Работайте с сайтом — его запросы появятся здесь.' : 'Включите слежение и поработайте с сайтом.' }}</p>
        <p v-else>Ничего не подходит.</p>
      </div>
      <div v-for="e in shown" :key="e.key" class="am-it" :class="{ open: open === e.key }">
        <div class="am-row" @click="open = open === e.key ? undefined : e.key">
          <input type="checkbox" class="am-ck" :checked="picked.has(e.key)" title="Выбрать — для переноса в блокнот" @click.stop @change="pick(e.key)" />
          <i class="m" :class="e.method.toLowerCase()">{{ e.method }}</i>
          <code class="p" :title="e.path">{{ e.path }}<em v-if="e.op"> · {{ e.op }}</em></code>
          <span class="n" title="Вызовов">{{ e.count }}</span>
          <span v-if="errCount(e)" class="n bad" :title="statusLine(e)">✗{{ errCount(e) }}</span>
          <span class="n t" title="Среднее время ответа">{{ ms(avgMs(e)) }}</span>
          <span v-if="cmp" class="sp" :class="{ no: !cmp.byKey[e.key] }" :title="cmp.byKey[e.key] ? `Swagger: ${cmp.byKey[e.key].method.toUpperCase()} ${cmp.byKey[e.key].path}${cmp.byKey[e.key].summary ? ` — ${cmp.byKey[e.key].summary}` : ''}` : 'Нет в Swagger'">{}</span>
        </div>
        <div v-if="open === e.key" class="am-more">
          <p v-if="cmp?.byKey[e.key]?.summary" class="am-sum">{{ cmp.byKey[e.key].summary }}</p>
          <dl>
            <dt>Ответы</dt>
            <dd>{{ statusLine(e).replace(/\b0×/, 'сбой×') }}</dd>
            <dt>Время</dt>
            <dd>среднее {{ ms(avgMs(e)) }}, макс. {{ ms(e.msMax) }}</dd>
            <dt>Когда</dt>
            <dd>{{ ago(e.first) }} — {{ ago(e.last) }}</dd>
            <template v-if="e.query.length"><dt>Параметры</dt><dd><code v-for="k in e.query" :key="k">{{ k }}</code></dd></template>
            <template v-if="Object.keys(e.pages).length"><dt>Страницы</dt><dd><code v-for="(n, p) in e.pages" :key="p" :title="`${n} раз`">{{ p }}</code></dd></template>
          </dl>
          <div class="seg">
            <button :class="{ on: tab === 'res' }" @click="tab = 'res'">Приходит <b>{{ Object.keys(e.res.fields).length }}</b></button>
            <button :class="{ on: tab === 'req' }" @click="tab = 'req'">Отправляется <b>{{ Object.keys(e.req.fields).length }}</b></button>
            <button :class="{ on: tab === 'hd' }" title="Заголовки запроса и ответа (секреты скрыты)" @click="tab = 'hd'">Заголовки</button>
            <button :class="{ on: tab === 'ex' }" @click="tab = 'ex'">Пример</button>
          </div>
          <template v-if="tab === 'hd'">
            <p v-if="!samplesOf(e).some((s) => s.reqHeaders || s.resHeaders)" class="muted">Заголовков пока нет — они сохраняются у новых вызовов.</p>
            <template v-for="s in samplesOf(e)" v-else :key="s.at">
              <p class="am-sh">
                <b :class="{ bad: s.status === 0 || s.status >= 400 }">{{ s.status === 0 ? 'сбой' : s.status }}</b><span class="muted">{{ ago(s.at) }}</span>
              </p>
              <template v-for="part in [{ t: 'Запрос', h: s.reqHeaders }, { t: 'Ответ', h: s.resHeaders }]" :key="part.t">
                <table v-if="part.h" class="am-f am-h">
                  <!-- (the columns' widths set here — a fixed table takes them from its first row, the heading over all three) -->
                  <colgroup><col class="hk" /><col /><col class="hb" /></colgroup>
                  <thead>
                    <tr><th colspan="3">{{ part.t }} <span class="muted">{{ part.h.length }}</span></th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="[k, v] in part.h" :key="k">
                      <td><code>{{ k }}</code></td>
                      <td class="ex" :title="v">{{ v }}</td>
                      <td class="cp"><button class="hc" :title="copied === `h:${s.at}:${part.t}:${k}` ? 'Скопировано' : 'Копировать значение'" @click="copy(v, `h:${s.at}:${part.t}:${k}`)"><Icon :name="copied === `h:${s.at}:${part.t}:${k}` ? 'check' : 'copy'" :size="12" /></button></td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </template>
          </template>
          <template v-else-if="tab !== 'ex'">
            <p v-if="!rowsOf(tab === 'res' ? e.res : e.req).length" class="muted">{{ tab === 'res' ? 'Ответы с JSON пока не попадались.' : 'Тела запроса нет (или не JSON).' }}</p>
            <table v-else class="am-f">
              <tbody>
                <tr v-for="r in rowsOf(tab === 'res' ? e.res : e.req)" :key="r.p">
                  <td :style="{ paddingLeft: `${6 + depth(r.p) * 10}px` }"><code>{{ r.p.split(/\.(?![^[]*\])/).pop() }}</code></td>
                  <td class="ty">{{ r.type }}</td>
                  <td class="of" :title="r.often === 'всегда' ? 'В каждом теле' : 'В скольких телах было'">{{ r.often }}</td>
                  <td class="ex" :title="r.ex">{{ r.ex }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted">Тел просмотрено: {{ (tab === 'res' ? e.res : e.req).bodies }}</p>
          </template>
          <template v-else>
            <template v-for="s in [e.sample, e.errSample].filter(Boolean)" :key="s!.at">
              <p class="am-sh">
                <b :class="{ bad: s!.status === 0 || s!.status >= 400 }">{{ s!.status === 0 ? 'сбой' : s!.status }}</b><span class="muted">{{ ago(s!.at) }}</span>
              </p>
              <pre class="am-pre">{{ e.method }} {{ s!.url }}{{ s!.reqBody ? `\n\n${s!.reqBody}` : '' }}</pre>
              <pre v-if="s!.resBody" class="am-pre res">{{ s!.resBody }}</pre>
            </template>
            <div class="am-acts">
              <button :disabled="!asHttp(e)" title="Запрос текстом — вставьте в блок HTTP заметки и выполните" @click="copyOne(e)"><Icon name="copy" :size="12" />{{ copied === e.key ? 'Скопировано' : 'Копировать запрос' }}</button>
            </div>
          </template>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.am {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px;
  font-size: 12.5px;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
}
.am-off {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgb(var(--accent-rgb) / 0.1);
  color: var(--text-2);
}
.am-off button {
  flex: none;
}
.am-top,
.am-spec,
.am-flt,
.am-q {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.am-top select {
  min-width: 0;
  max-width: 100%;
  flex: 0 1 auto;
}
/* the view: the traffic's map / the site's Swagger */
.am-seg {
  display: inline-flex;
  flex: none;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  overflow: hidden;
}
.am-seg button {
  height: 24px;
  padding: 0 9px;
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
.am-seg button + button {
  border-left: 1px solid var(--border-2);
}
.am-seg button.on {
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--text);
}
/* the clear asked once more — in words, red */
.sure {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--down-fg);
  border-radius: 6px;
  background: color-mix(in srgb, var(--down-fg) 14%, transparent);
  color: var(--down-fg);
  font-size: 12px;
  white-space: nowrap;
}
select,
.am-q input {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.ib {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-2);
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib.warn {
  background: rgb(239 68 68 / 0.18);
  color: var(--down-fg);
}
.am-made,
.am-er {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}
.am-er {
  color: var(--down-fg);
}
.am-spec {
  white-space: nowrap;
  overflow: hidden;
}
.am-sl {
  overflow: hidden;
  text-overflow: ellipsis;
}
.pglyph {
  font-family: var(--font-data);
  font-weight: 700;
  color: var(--accent);
}
.lnk {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  white-space: nowrap;
}
.lnk.on {
  text-decoration: underline;
}
.am-nc {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: auto;
}
.am-nr {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
}
.am-nr .muted {
  overflow: hidden;
  text-overflow: ellipsis;
}
.am-flt {
  flex-wrap: nowrap;
  overflow: hidden;
}
.am-flt button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  white-space: nowrap;
}
.am-flt button.on {
  border-color: rgb(var(--accent-rgb) / 0.5);
  background: rgb(var(--accent-rgb) / 0.14);
  color: var(--text);
}
.am-flt button.bad b {
  color: var(--down-fg);
}
.am-q label {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-left: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--muted);
}
.am-q label input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
}
.am-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 0 4px;
  white-space: nowrap;
}
.am-pick label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
}
/* the row's actions — one height */
.am-pick > button,
.am-pick .np {
  height: 28px;
}
.am-pick > .ib {
  width: 28px;
}
.am-pick .primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
}
.am-ck {
  flex: none;
  margin: 0;
}
.am-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.am-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 30px 16px;
  color: var(--muted);
  text-align: center;
}
.am-it {
  border-bottom: 1px solid var(--border);
}
.am-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 4px;
  cursor: pointer;
  white-space: nowrap;
}
.am-row:hover {
  background: var(--hover);
}
.m {
  flex: none;
  width: 52px;
  font-family: var(--font-data);
  font-size: 10.5px;
  font-style: normal;
  font-weight: 700;
  color: var(--up-fg);
}
.m.post {
  color: var(--accent);
}
.m.put,
.m.patch {
  color: var(--warn-fg);
}
.m.delete {
  color: var(--down-fg);
}
.p {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-data);
  font-size: 12px;
}
.p em {
  color: var(--muted);
  font-style: normal;
}
.n {
  flex: none;
  font-family: var(--font-data);
  font-size: 11px;
  color: var(--text-2);
}
.n.bad {
  color: var(--down-fg);
}
.n.t {
  width: 52px;
  text-align: right;
  color: var(--muted);
}
.sp {
  flex: none;
  font-family: var(--font-data);
  font-size: 11px;
  font-weight: 700;
  color: var(--up-fg);
}
.sp.no {
  color: var(--down-fg);
  opacity: 0.8;
}
.am-more {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 6px 10px 10px;
}
.am-sum {
  margin: 0;
  color: var(--text-2);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin: 0;
}
dt {
  color: var(--muted);
}
dd {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  min-width: 0;
}
dd code,
.am-nr code {
  font-family: var(--font-data);
  font-size: 11.5px;
}
dd code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--panel-3);
  overflow-wrap: anywhere;
}
.seg {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
}
.seg button {
  height: 24px;
  padding: 0 9px;
  border: 0;
  background: transparent;
  color: var(--text-2);
  white-space: nowrap;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--text);
}
.seg b {
  font-weight: 500;
  color: var(--muted);
}
.am-f {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.am-f td {
  padding: 2px 6px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: top;
}
.am-f td:first-child {
  width: 34%;
}
.am-f code {
  font-family: var(--font-data);
  font-size: 11.5px;
}
.am-f .ty {
  width: 30%;
  color: var(--text-2);
}
.am-f .of {
  width: 62px;
  color: var(--muted);
}
/* the headers: a request's, an answer's — a name, its value (selectable, whole in the hint) */
.am-h {
  margin-bottom: 6px;
  user-select: text;
}
.am-h th {
  padding: 2px 6px;
  border-bottom: 1px solid var(--border-2);
  color: var(--text-2);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.am-h .ex {
  color: var(--text);
}
/* a header's value copied by its own button (a fresh token — into a request): the name, the value up to the button,
   the button at the right edge — whatever the panel's width */
.am-h col.hk {
  width: 34%;
}
.am-h col.hb {
  width: 28px;
}
.am-h td:first-child {
  width: auto;
}
.am-h td.cp {
  padding: 0 2px;
  text-align: right;
}
.am-h .hc {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
}
.am-h .hc:hover {
  background: var(--hover);
  color: var(--text);
}
.am-f .ex {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.am-sh {
  display: flex;
  gap: 8px;
  margin: 0;
}
.am-sh b {
  color: var(--up-fg);
}
.am-sh b.bad {
  color: var(--down-fg);
}
.am-pre {
  max-height: 220px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  overflow: auto;
  font-family: var(--font-data);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
}
.am-pre.res {
  color: var(--text-2);
}
.am-acts button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
}
</style>
