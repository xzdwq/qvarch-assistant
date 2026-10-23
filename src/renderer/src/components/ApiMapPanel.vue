<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { avgMs, compareSpec, errCount, searchMatch, searchText, searchWords, statusLine, type ApiEndpoint } from '@shared/apiMap'
import type { ApiOp, ApiSpec } from '@shared/openapi'
import { apiMapHosts, apiMapTick, checkState } from '../lib/browser'
import { openNote } from '../lib/mentions'
import Icon from './Icon.vue'
import NotePicker from './NotePicker.vue'
import SwaggerOps from './SwaggerOps.vue'
import ApiEndpointDetails from './apiMap/ApiEndpointDetails.vue'
import { ms } from './apiMap/apiMapFormat'
import { useApiMapExport } from './apiMap/useApiMapExport'

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
/** The list's filters: what an endpoint must be to be shown (and counted on the filter's chip). */
const FILTERS = {
  err: (e: ApiEndpoint) => errCount(e) > 0,
  write: (e: ApiEndpoint) => e.method !== 'GET',
  nospec: (e: ApiEndpoint) => !!cmp.value && !cmp.value.byKey[e.key],
} satisfies Record<string, (e: ApiEndpoint) => boolean>
type Flt = '' | keyof typeof FILTERS
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
      (!words.length || searchMatch(hayOf(e), words)) && (!flt.value || FILTERS[flt.value](e)),
  )
  const by: Record<Sort, (a: ApiEndpoint, b: ApiEndpoint) => number> = {
    path: (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    count: (a, b) => b.count - a.count,
    ms: (a, b) => avgMs(b) - avgMs(a),
    last: (a, b) => b.last - a.last,
  }
  return out.sort(by[sort.value])
})
const nErr = computed(() => list.value.filter(FILTERS.err).length)
const nWrite = computed(() => list.value.filter(FILTERS.write).length)
const nNoSpec = computed(() => list.value.filter(FILTERS.nospec).length)

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

// ---------- carried out: the clipboard, a note ----------
const { copied, copy, copyOne, copyPicked, made, mdErr, toNote, onPickNote } = useApiMapExport({ host, list, picked, spec, cmp })

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
  <div class="am tw:flex tw:flex-col tw:gap-8 tw:min-h-0 tw:p-10 tw:text-[12.5px]">
    <p v-if="!checkState.settings.on" class="am-off tw:flex tw:items-center tw:gap-8 tw:m-0 tw:py-8 tw:px-10 tw:rounded-[6px] tw:bg-accent/10 tw:text-text-2">
      <Icon name="map" :size="13" /><span>Карта собирается, пока включено слежение «Проверки». Работайте с сайтом как обычно — сюда попадёт каждый запрос его страниц.</span>
      <button class="primary tw:flex-none tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:hover:enabled:border-accent-hi" @click="setOn">Включить</button>
    </p>
    <div class="am-top tw:flex tw:items-center tw:gap-6 tw:min-w-0">
      <select class="tw:min-w-0 tw:max-w-full tw:flex-[0_1_auto] tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="host" :disabled="!hostOptions.length" title="Сайт">
        <option v-if="!hostOptions.length" value="">сайтов пока нет</option>
        <option v-for="h in hostOptions" :key="h.host" :value="h.host">{{ h.host }} · {{ h.n }}</option>
      </select>
      <span class="am-seg tw:inline-flex tw:flex-none tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button class="tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:[&.on]:bg-accent/16 tw:[&.on]:text-text" :class="{ on: view === 'traffic' }" title="Запросы, которые делают страницы сайта" @click="view = 'traffic'">Трафик</button>
        <button class="tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:[&.on]:bg-accent/16 tw:[&.on]:text-text" :class="{ on: view === 'swagger' }" title="Swagger / OpenAPI сайта: найти, перенести в HTTP и в блокнот" @click="((view = 'swagger'), (onlyNotCalled = false))">Swagger<b v-if="api"> {{ api.info.ops.length }}</b></button>
      </span>
      <span class="grow tw:flex-1"></span>
      <!-- (the clearing first: its «Очистить?» grows to the left, into the free room — nothing moves under the cursor) -->
      <button v-if="sure && view === 'traffic'" class="sure tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-down-fg tw:rounded-[6px] tw:bg-[color-mix(in_srgb,var(--down-fg)_14%,transparent)] tw:text-down-fg tw:text-[12px] tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:hover:enabled:not-[.am-seg_button+&]:border-border-3" title="Карта этого сайта будет очищена" @click="clear" @mouseenter="holdSure" @mouseleave="releaseSure"><Icon name="trash" :size="12" />Очистить?</button>
      <button v-else-if="view === 'traffic'" class="ib tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:inline-grid tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:not-[.am-seg_button+&]:border-border-3" :disabled="!list.length" title="Очистить карту этого сайта" @click="clear"><Icon name="trash" :size="14" /></button>
      <button v-if="view === 'traffic'" class="ib tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:inline-grid tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:not-[.am-seg_button+&]:border-border-3" :disabled="!list.length" title="Вся карта сайта — в заметку (папка «Карты API»): таблица, поля, запросы, которые можно выполнить" @click="toNote()"><Icon name="note" :size="14" /></button>
    </div>
    <p v-if="made" class="am-made tw:flex tw:items-center tw:gap-6 tw:m-0"><Icon name="check" :size="12" />Заметка: <a href="#" @click.prevent="openNote(made.path)">{{ made.name }}</a><button class="ib tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:inline-grid tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:not-[.am-seg_button+&]:border-border-3" @click="made = undefined"><Icon name="x" :size="11" /></button></p>
    <p v-if="mdErr" class="am-er tw:flex tw:items-center tw:gap-6 tw:m-0 tw:text-down-fg">{{ mdErr }}</p>

    <SwaggerOps v-if="view === 'swagger'" :api="api" :busy="!!apiBusy" :error="apiError ?? ''" :tried="apiTried ?? []" :not-called="notCalledIds" :can-find="!!canFind" :only-not-called="onlyNotCalled" @find="emit('findSwagger')" @clear="emit('clearSwagger')" @to-http="(ids) => emit('swaggerToHttp', ids)" @made="(m) => (made = m)" />
    <template v-else>
    <!-- the Swagger beside it -->
    <div v-if="host" class="am-spec tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:whitespace-nowrap tw:overflow-hidden">
      <template v-if="spec && cmp">
        <span class="pglyph tw:font-data tw:font-bold tw:text-accent">{}</span>
        <span class="am-sl tw:overflow-hidden tw:text-ellipsis">Swagger: в нём {{ list.length - nNoSpec }} из {{ list.length }}</span>
        <button v-if="cmp.notCalled.length" class="lnk tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:hover:enabled:not-[.am-seg_button+&]:border-border-3" title="Методы Swagger, которые страницы ни разу не вызвали — непроверенное: открыть их список" @click="((onlyNotCalled = true), (view = 'swagger'))">не вызывались: {{ cmp.notCalled.length }}</button>
      </template>
      <template v-else>
        <span class="muted tw:text-muted">Swagger не найден — карта только по трафику</span>
        <button class="lnk tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:hover:enabled:not-[.am-seg_button+&]:border-border-3" title="Поискать Swagger / OpenAPI на этом сайте" @click="((view = 'swagger'), emit('findSwagger'))">найти</button>
      </template>
    </div>

    <div class="am-flt tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:flex-nowrap tw:overflow-hidden">
      <button class="tw:[.am-seg_button+&]:not-[&.on]:border-l tw:[.am-seg_button+&]:not-[&.on]:border-l-border-2 tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:border-accent/50 tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" :class="{ on: !flt }" @click="flt = ''">Все <b>{{ list.length }}</b></button>
      <button class="tw:[.am-seg_button+&]:not-[&.on]:border-l tw:[.am-seg_button+&]:not-[&.on]:border-l-border-2 tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:border-accent/50 tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" :class="{ on: flt === 'write' }" title="POST / PUT / PATCH / DELETE" @click="flt = flt === 'write' ? '' : 'write'">Мутируют <b>{{ nWrite }}</b></button>
      <button class="tw:group/g24 tw:[.am-seg_button+&]:not-[&.on]:border-l tw:[.am-seg_button+&]:not-[&.on]:border-l-border-2 tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:border-accent/50 tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" :class="{ on: flt === 'err', bad: nErr }" title="Были ответы 4xx / 5xx или сбои" @click="flt = flt === 'err' ? '' : 'err'">С ошибками <b class="tw:group-[.bad]/g24:text-down-fg">{{ nErr }}</b></button>
      <button class="tw:[.am-seg_button+&]:not-[&.on]:border-l tw:[.am-seg_button+&]:not-[&.on]:border-l-border-2 tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:border-accent/50 tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" v-if="cmp" :class="{ on: flt === 'nospec' }" title="Вызываются страницами, но в Swagger их нет" @click="flt = flt === 'nospec' ? '' : 'nospec'">Нет в Swagger <b>{{ nNoSpec }}</b></button>
    </div>
    <div class="am-q tw:flex tw:items-center tw:gap-6 tw:min-w-0">
      <label class="tw:flex tw:flex-1 tw:items-center tw:gap-6 tw:min-w-0 tw:pl-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-muted"><Icon name="search" :size="12" /><input class="tw:h-26 tw:py-0 tw:px-6 tw:rounded-[4px] tw:text-text tw:[font:inherit] tw:flex-1 tw:min-w-0 tw:border-0 tw:bg-transparent" v-model="qIn" placeholder="Путь или адрес целиком, поле, код ответа…" title="Можно вставить адрес запроса целиком — id в нём сведутся к :id. Несколько слов — должны найтись все" spellcheck="false" /></label>
      <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="sort" title="Порядок">
        <option v-for="s in SORTS" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
    </div>

    <div v-if="shown.length" class="am-pick tw:flex tw:items-center tw:gap-8 tw:min-h-26 tw:py-0 tw:px-4 tw:whitespace-nowrap">
      <label class="tw:inline-flex tw:items-center tw:gap-8 tw:text-text-2" :title="allShownPicked ? 'Снять отметку с показанных' : 'Отметить все показанные'"><input type="checkbox" :checked="allShownPicked" :indeterminate.prop="!allShownPicked && shown.some((e) => picked.has(e.key))" @change="pickShown" /><span>{{ picked.size ? `Выбрано: ${picked.size}` : 'Выбрать' }}</span></label>
      <template v-if="picked.size">
        <span class="grow tw:flex-1"></span>
        <button class="ib tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:inline-grid tw:place-items-center tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:h-28 tw:w-28 tw:hover:enabled:not-[.am-seg_button+&]:border-border-3" :title="copied === 'picked' ? 'Скопировано' : 'Копировать выбранные как HTTP-блоки (с входом сайта) — вставьте в любую заметку'" @click="copyPicked"><Icon :name="copied === 'picked' ? 'check' : 'copy'" :size="14" /></button>
        <NotePicker class="primary sm tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:[&&]:inline-flex tw:[&&]:items-center tw:[&&]:gap-5 tw:[&&]:h-28 tw:[&&]:py-0 tw:[&&]:px-10 tw:hover:enabled:border-accent-hi" title="Выбранные запросы — новой заметкой (папка «Карты API») или в конец заметки, что есть" new-label="Новая заметка (папка «Карты API»)" @pick="onPickNote" />
      </template>
    </div>
    <div class="am-list tw:flex tw:flex-1 tw:flex-col tw:min-h-0 tw:overflow-auto">
      <div v-if="!shown.length" class="am-empty tw:flex tw:flex-col tw:items-center tw:gap-8 tw:py-30 tw:px-16 tw:text-muted tw:text-center">
        <Icon name="map" :size="26" />
        <p v-if="!list.length">{{ host === tabHost && tabHost ? 'Страницы этого сайта ещё не обращались к API (XHR / fetch).' : 'Карта пуста.' }} {{ checkState.settings.on ? 'Работайте с сайтом — его запросы появятся здесь.' : 'Включите слежение и поработайте с сайтом.' }}</p>
        <p v-else>Ничего не подходит.</p>
      </div>
      <div v-for="e in shown" :key="e.key" class="am-it tw:border-b tw:border-b-border" :class="{ open: open === e.key }">
        <div class="am-row tw:flex tw:items-center tw:gap-6 tw:min-h-30 tw:py-0 tw:px-4 tw:cursor-pointer tw:whitespace-nowrap tw:hover:bg-hover" @click="open = open === e.key ? undefined : e.key">
          <input type="checkbox" class="am-ck tw:flex-none tw:m-0" :checked="picked.has(e.key)" title="Выбрать — для переноса в блокнот" @click.stop @change="pick(e.key)" />
          <i class="m tw:flex-none tw:w-52 tw:font-data tw:text-[10.5px] tw:not-italic tw:font-bold tw:text-up-fg" :class="e.method.toLowerCase()">{{ e.method }}</i>
          <code class="p tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:font-data tw:text-[12px]" :title="e.path">{{ e.path }}<em class="tw:text-muted tw:not-italic" v-if="e.op"> · {{ e.op }}</em></code>
          <span class="n tw:flex-none tw:font-data tw:text-[11px] tw:text-text-2" title="Вызовов">{{ e.count }}</span>
          <span v-if="errCount(e)" class="n bad tw:flex-none tw:font-data tw:text-[11px] tw:text-down-fg" :title="statusLine(e)">✗{{ errCount(e) }}</span>
          <span class="n t tw:flex-none tw:font-data tw:text-[11px] tw:w-52 tw:text-right tw:text-muted" title="Среднее время ответа">{{ ms(avgMs(e)) }}</span>
          <span v-if="cmp" class="sp tw:flex-none tw:font-data tw:text-[11px] tw:font-bold tw:text-up-fg tw:[&.no]:text-down-fg tw:[&.no]:opacity-80" :class="{ no: !cmp.byKey[e.key] }" :title="cmp.byKey[e.key] ? `Swagger: ${cmp.byKey[e.key].method.toUpperCase()} ${cmp.byKey[e.key].path}${cmp.byKey[e.key].summary ? ` — ${cmp.byKey[e.key].summary}` : ''}` : 'Нет в Swagger'">{}</span>
        </div>
        <ApiEndpointDetails v-if="open === e.key" v-model:tab="tab" :e="e" :summary="cmp?.byKey[e.key]?.summary" :copied="copied" @copy="copy" @copy-one="copyOne(e)" />
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped src="./ApiMapPanel.css"></style>
