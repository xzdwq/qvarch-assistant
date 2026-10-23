<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { apiPath, type ApiEndpoint } from '@shared/apiMap'
import { decodeRequest, FUZZ_SETS, paramsOf, readFuzz, writeFuzz, type FuzzParam, type FuzzSpec, type ParamKind } from '@shared/fuzz'
import { apiMapHosts } from '@renderer/lib/browser'
import Icon from '@renderer/components/Icon.vue'

/**
 * «Параметры перебора»: the request (the one the scenario sends — by its method and address; its example from the
 * API map, used when the scenario does not send it), its parameters to try and each one's values — one's own rows,
 * typical sets added as rows to edit; where «how many found» is in the answer. Written into the scenario's code.
 */
const props = defineProps<{ code: string }>()
const emit = defineEmits<{ update: [code: string] }>()

const spec = ref<FuzzSpec>({ request: '', params: [] })
let mine = ''
watch(
  () => props.code,
  (c) => {
    if (c === mine) return
    const s = readFuzz(c)?.spec
    if (s) spec.value = JSON.parse(JSON.stringify(s)) as FuzzSpec
  },
  { immediate: true },
)
function save(): void {
  mine = writeFuzz(props.code, JSON.parse(JSON.stringify(spec.value)) as FuzzSpec)
  emit('update', mine)
}

// ---------- the request: from the API map of the scenario's site ----------
/** The site the scenario opens (its first page.goto). */
const site = computed(() => {
  const u = /page\.goto\((['"`])(.+?)\1/.exec(props.code)?.[2]
  try {
    return u ? new URL(u).host : ''
  } catch {
    return ''
  }
})
const host = ref('')
watch(
  [site, () => apiMapHosts.value.length],
  () => {
    if (host.value && apiMapHosts.value.some((h) => h.host === host.value)) return
    host.value = apiMapHosts.value.some((h) => h.host === site.value) ? site.value : (apiMapHosts.value[0]?.host ?? '')
  },
  { immediate: true },
)
const eps = shallowRef<ApiEndpoint[]>([])
watch(
  host,
  async (h) => (eps.value = h ? ((await window.qa.browser('apiMapList', h)) as ApiEndpoint[]).filter((e) => e.sample?.url) : []),
  { immediate: true },
)
const epQuery = ref('')
const epShown = computed(() => {
  const w = epQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return eps.value.filter((e) => w.every((x) => `${e.method} ${e.path}`.toLowerCase().includes(x))).slice(0, 60)
})
const epOpen = ref(false)
function pickEp(e: ApiEndpoint): void {
  spec.value.request = `${e.method} ${e.path}`
  spec.value.sample = { url: e.sample!.url, ...(e.sample!.reqBody !== undefined ? { body: e.sample!.reqBody } : {}) }
  epOpen.value = false
  save()
}
function setRequest(v: string): void {
  const m = /^\s*([A-Za-z]+)\s+(\S+)/.exec(v)
  // an address pasted whole: its path (ids as :id), the address kept as the example
  if (m && /^https?:/i.test(m[2])) {
    spec.value.request = `${m[1].toUpperCase()} ${apiPath(m[2]).path}`
    spec.value.sample = { ...spec.value.sample, url: m[2] }
  } else spec.value.request = v.trim()
  save()
}

// ---------- the parameters ----------
const decoded = computed(() => {
  const s = spec.value.sample
  if (!s?.url) return undefined
  try {
    return decodeRequest({ method: spec.value.request.split(/\s+/)[0] || 'GET', url: s.url, body: s.body, contentType: s.contentType })
  } catch {
    return undefined
  }
})
const offered = computed(() => (decoded.value ? paramsOf(decoded.value) : []))
/** A parameter's kind: the example's; none — by its values (an array's sizes), else not known. */
const kindOf = (path: string): ParamKind | undefined =>
  offered.value.find((p) => p.path === path)?.kind ?? (spec.value.params.find((p) => p.path === path)?.cases.some((c) => /^\s*size\(/.test(c.value)) ? 'array' : undefined)
const sampleOf = (path: string) => offered.value.find((p) => p.path === path)?.sample
const KIND_RU: Record<ParamKind, string> = { array: 'массив', string: 'строка', number: 'число', boolean: 'да / нет', null: 'null', object: 'объект' }
const addPath = ref('')
function addParam(path: string): void {
  const p = path.trim()
  if (!p || spec.value.params.some((x) => x.path === p)) return
  const kind = kindOf(p)
  spec.value.params.push({ path: p, cases: [], ...(kind === 'array' ? { monotonic: true } : {}) })
  open.value = p
  addPath.value = ''
  save()
}
const open = ref<string>()
function addSet(p: FuzzParam, id: string): void {
  const set = FUZZ_SETS.find((s) => s.id === id)
  if (!set) return
  for (const c of set.cases) if (!p.cases.some((x) => x.value === c.value)) p.cases.push({ ...c })
  if (set.monotonic && p.monotonic === undefined) p.monotonic = true
  save()
}
const setsFor = (p: FuzzParam) => {
  const k = kindOf(p.path)
  return k ? [...FUZZ_SETS.filter((s) => s.kinds.includes(k)), ...FUZZ_SETS.filter((s) => !s.kinds.includes(k))] : FUZZ_SETS
}
const total = computed(() => spec.value.params.reduce((n, p) => n + p.cases.length, 0))
</script>

<template>
  <div class="fz tw:flex tw:basis-full tw:box-border tw:min-w-0 tw:max-w-full tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-[12.5px]">
    <div class="fz-head tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <b>Параметры перебора</b>
      <span class="muted tw:text-muted">параметров {{ spec.params.length }} · вариантов {{ total }}</span>
    </div>

    <div class="fz-row tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <span class="lab tw:flex-none tw:text-text-2">Запрос</span>
      <input class="req tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:flex-[1_1_200px]" :value="spec.request" placeholder="POST /api/items/search — или вставьте адрес целиком" spellcheck="false" @change="setRequest(($event.target as HTMLInputElement).value)" />
      <button class="pick tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-dashed tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:[&.on]:not-hover:border-accent tw:hover:border-accent tw:[&.on]:not-hover:text-text tw:hover:text-text tw:hover:enabled:bg-hover" :class="{ on: epOpen }" title="Выбрать из карты API (запросы, которые сайт уже отправлял во вкладке Браузера)" @click="epOpen = !epOpen"><Icon name="api" :size="12" />из карты API</button>
    </div>
    <div v-if="epOpen" class="fz-eps tw:flex tw:flex-col tw:gap-6 tw:p-6 tw:border tw:border-border tw:rounded-[6px]">
      <div class="fz-row tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
        <select class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="host" :disabled="!apiMapHosts.length" title="Сайт">
          <option v-if="!apiMapHosts.length" value="">карта API пуста — откройте сайт во вкладке Браузера</option>
          <option v-for="h in apiMapHosts" :key="h.host" :value="h.host">{{ h.host }} · {{ h.endpoints }}</option>
        </select>
        <input v-model="epQuery" class="q tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:flex-1" placeholder="Поиск: search, export…" spellcheck="false" />
      </div>
      <div class="list tw:flex tw:max-h-220 tw:flex-col tw:overflow-y-auto">
        <button v-for="e in epShown" :key="e.key" class="ep tw:flex tw:items-baseline tw:gap-6 tw:py-3 tw:px-6 tw:overflow-hidden tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-text tw:font-data tw:text-[12px] tw:text-left tw:text-ellipsis tw:whitespace-nowrap tw:hover:bg-hover tw:hover:enabled:border-border-3" :title="e.sample?.url" @click="pickEp(e)">
          <b class="m tw:flex-none tw:w-52 tw:text-accent">{{ e.method }}</b>{{ e.path }}<span v-if="e.op" class="muted tw:text-muted"> · {{ e.op }}</span><span class="muted cnt tw:ml-auto tw:flex-none tw:text-text-2 tw:text-[11.5px]">{{ e.count }}×</span>
        </button>
        <p v-if="!epShown.length" class="muted tw:text-muted">Нет запросов с образцом{{ epQuery ? ' по поиску' : '' }}.</p>
      </div>
    </div>
    <p class="note muted tw:text-muted tw:m-0 tw:text-[11.5px] tw:whitespace-normal">
      Берётся запрос, который отправил сценарий (выше этой проверки); если не отправил — образец<template v-if="spec.sample?.url"> <code class="tw:text-[11px] tw:break-all">{{ spec.sample.url }}</code></template
      ><template v-else> (не выбран)</template>. Вход — как у сценария: заголовки его же запросов к сайту, в заметку не пишутся.
    </p>

    <div class="fz-row tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <span class="lab tw:flex-none tw:text-text-2">Найдено</span>
      <input class="found tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:flex-[1_1_200px]" :value="spec.found ?? ''" placeholder="угадывается: total, count, data… или путь в ответе: meta.total" spellcheck="false" @change="((spec.found = ($event.target as HTMLInputElement).value.trim() || undefined), save())" />
      <span class="lab tw:flex-none tw:text-text-2">Медленно, мс</span>
      <input class="num tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-72" type="number" :value="spec.slowMs ?? ''" placeholder="авто" title="Ответ дольше — отмечается. По умолчанию 3 с или 5× от исходного" @change="((spec.slowMs = Number(($event.target as HTMLInputElement).value) || undefined), save())" />
    </div>

    <div v-for="(p, pi) in spec.params" :key="p.path" class="fz-p tw:border-t tw:border-t-border" :class="{ open: open === p.path }">
      <div class="fz-ph tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap tw:h-30 tw:cursor-pointer" @click="open = open === p.path ? undefined : p.path">
        <Icon :name="open === p.path ? 'chevronDown' : 'chevronRight'" :size="12" />
        <code>{{ p.path }}</code>
        <span class="muted kind tw:text-muted tw:overflow-hidden tw:text-ellipsis"><template v-if="kindOf(p.path)">{{ KIND_RU[kindOf(p.path)!] }}</template><template v-if="sampleOf(p.path)"> · сейчас {{ sampleOf(p.path) }}</template></span>
        <span class="grow tw:flex-1"></span>
        <span class="cnt tw:flex-none tw:text-text-2 tw:text-[11.5px]">{{ p.cases.length ? `вариантов ${p.cases.length}` : 'не перебирается' }}</span>
        <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Убрать параметр" @click.stop="(spec.params.splice(pi, 1), save())"><Icon name="x" :size="12" /></button>
      </div>
      <div v-if="open === p.path" class="fz-body tw:flex tw:flex-col tw:gap-6 tw:pt-0 tw:pr-0 tw:pb-10 tw:pl-20">
        <label v-if="p.cases.some((c) => /^\s*size\(/.test(c.value))" class="chk tw:flex tw:items-center tw:gap-6" title="Значения фильтра «одно из»: чем больше значений, тем не меньше найденных. Нарушение отмечается">
          <input class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" type="checkbox" :checked="!!p.monotonic" @change="((p.monotonic = ($event.target as HTMLInputElement).checked), save())" />больше значений → не меньше найденных
        </label>
        <div v-for="(c, ci) in p.cases" :key="ci" class="fz-case tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
          <input v-model="c.label" class="lbl tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-170" placeholder="Подпись" spellcheck="false" @change="save" />
          <input v-model="c.value" class="val tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:flex-[1_1_200px]" placeholder="size(21) · null · drop · '' · gen.text(255) · 'строка'" spellcheck="false" @change="save" />
          <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Убрать" @click="(p.cases.splice(ci, 1), save())"><Icon name="x" :size="12" /></button>
        </div>
        <div class="fz-add tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:flex-wrap tw:whitespace-normal">
          <span class="muted tw:text-muted">Добавить:</span>
          <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-dashed tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:hover:border-accent tw:hover:text-text" @click="(p.cases.push({ label: 'Своё', value: '' }), save())">своё значение</button>
          <select class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" title="Типовой набор — добавится строками, их можно править и убирать" value="" @change="(addSet(p, ($event.target as HTMLSelectElement).value), (($event.target as HTMLSelectElement).value = ''))">
            <option value="" disabled>типовой набор…</option>
            <option v-for="s in setsFor(p)" :key="s.id" :value="s.id" :title="s.cases.map((c) => c.label).join('\n')">{{ s.title }} ({{ s.cases.length }})</option>
          </select>
        </div>
        <p class="note muted tw:text-muted tw:m-0 tw:text-[11.5px] tw:whitespace-normal">Значение — выражение: <code class="tw:text-[11px] tw:break-all">size(21)</code> массив из 21 (из отправленных элементов), <code class="tw:text-[11px] tw:break-all">size(21, (i) =&gt; i + 1)</code> свои элементы, <code class="tw:text-[11px] tw:break-all">drop</code> — параметра нет, <code class="tw:text-[11px] tw:break-all">null</code>, <code class="tw:text-[11px] tw:break-all">''</code>, <code class="tw:text-[11px] tw:break-all">gen.text(255)</code>, <code class="tw:text-[11px] tw:break-all">orig</code> — что было отправлено.</p>
      </div>
    </div>

    <div class="fz-row tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <span class="lab tw:flex-none tw:text-text-2">Параметр</span>
      <select class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-if="offered.length" title="Параметры образца запроса" value="" @change="(addParam(($event.target as HTMLSelectElement).value), (($event.target as HTMLSelectElement).value = ''))">
        <option value="" disabled>выбрать из запроса…</option>
        <option v-for="o in offered.filter((o) => !spec.params.some((p) => p.path === o.path))" :key="o.path" :value="o.path">{{ o.path }} — {{ KIND_RU[o.kind] }}: {{ o.sample }}</option>
      </select>
      <input v-model="addPath" class="path tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:flex-[1_1_200px]" placeholder="или путь: body.filter.ids, query.limit" spellcheck="false" @keydown.enter.prevent="addParam(addPath)" />
      <button class="pick tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-dashed tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:hover:border-accent tw:hover:text-text tw:hover:enabled:bg-hover" :disabled="!addPath.trim()" @click="addParam(addPath)"><Icon name="plus" :size="12" />добавить</button>
    </div>
  </div>
</template>
