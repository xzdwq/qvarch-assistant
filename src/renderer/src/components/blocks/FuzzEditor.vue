<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { apiPath, type ApiEndpoint } from '@shared/apiMap'
import { decodeRequest, FUZZ_SETS, paramsOf, readFuzz, writeFuzz, type FuzzParam, type FuzzSpec, type ParamKind } from '@shared/fuzz'
import { apiMapHosts } from '../../lib/browser'
import Icon from '../Icon.vue'

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
  <div class="fz">
    <div class="fz-head">
      <b>Параметры перебора</b>
      <span class="muted">параметров {{ spec.params.length }} · вариантов {{ total }}</span>
    </div>

    <div class="fz-row">
      <span class="lab">Запрос</span>
      <input class="req" :value="spec.request" placeholder="POST /api/items/search — или вставьте адрес целиком" spellcheck="false" @change="setRequest(($event.target as HTMLInputElement).value)" />
      <button class="pick" :class="{ on: epOpen }" title="Выбрать из карты API (запросы, которые сайт уже отправлял во вкладке Браузера)" @click="epOpen = !epOpen"><Icon name="api" :size="12" />из карты API</button>
    </div>
    <div v-if="epOpen" class="fz-eps">
      <div class="fz-row">
        <select v-model="host" :disabled="!apiMapHosts.length" title="Сайт">
          <option v-if="!apiMapHosts.length" value="">карта API пуста — откройте сайт во вкладке Браузера</option>
          <option v-for="h in apiMapHosts" :key="h.host" :value="h.host">{{ h.host }} · {{ h.endpoints }}</option>
        </select>
        <input v-model="epQuery" class="q" placeholder="Поиск: search, export…" spellcheck="false" />
      </div>
      <div class="list">
        <button v-for="e in epShown" :key="e.key" class="ep" :title="e.sample?.url" @click="pickEp(e)">
          <b class="m">{{ e.method }}</b>{{ e.path }}<span v-if="e.op" class="muted"> · {{ e.op }}</span><span class="muted cnt">{{ e.count }}×</span>
        </button>
        <p v-if="!epShown.length" class="muted">Нет запросов с образцом{{ epQuery ? ' по поиску' : '' }}.</p>
      </div>
    </div>
    <p class="note muted">
      Берётся запрос, который отправил сценарий (выше этой проверки); если не отправил — образец<template v-if="spec.sample?.url"> <code>{{ spec.sample.url }}</code></template
      ><template v-else> (не выбран)</template>. Вход — как у сценария: заголовки его же запросов к сайту, в заметку не пишутся.
    </p>

    <div class="fz-row">
      <span class="lab">Найдено</span>
      <input class="found" :value="spec.found ?? ''" placeholder="угадывается: total, count, data… или путь в ответе: meta.total" spellcheck="false" @change="((spec.found = ($event.target as HTMLInputElement).value.trim() || undefined), save())" />
      <span class="lab">Медленно, мс</span>
      <input class="num" type="number" :value="spec.slowMs ?? ''" placeholder="авто" title="Ответ дольше — отмечается. По умолчанию 3 с или 5× от исходного" @change="((spec.slowMs = Number(($event.target as HTMLInputElement).value) || undefined), save())" />
    </div>

    <div v-for="(p, pi) in spec.params" :key="p.path" class="fz-p" :class="{ open: open === p.path }">
      <div class="fz-ph" @click="open = open === p.path ? undefined : p.path">
        <Icon :name="open === p.path ? 'chevronDown' : 'chevronRight'" :size="12" />
        <code>{{ p.path }}</code>
        <span class="muted kind"><template v-if="kindOf(p.path)">{{ KIND_RU[kindOf(p.path)!] }}</template><template v-if="sampleOf(p.path)"> · сейчас {{ sampleOf(p.path) }}</template></span>
        <span class="grow"></span>
        <span class="cnt">{{ p.cases.length ? `вариантов ${p.cases.length}` : 'не перебирается' }}</span>
        <button class="ib" title="Убрать параметр" @click.stop="(spec.params.splice(pi, 1), save())"><Icon name="x" :size="12" /></button>
      </div>
      <div v-if="open === p.path" class="fz-body">
        <label v-if="p.cases.some((c) => /^\s*size\(/.test(c.value))" class="chk" title="Значения фильтра «одно из»: чем больше значений, тем не меньше найденных. Нарушение отмечается">
          <input type="checkbox" :checked="!!p.monotonic" @change="((p.monotonic = ($event.target as HTMLInputElement).checked), save())" />больше значений → не меньше найденных
        </label>
        <div v-for="(c, ci) in p.cases" :key="ci" class="fz-case">
          <input v-model="c.label" class="lbl" placeholder="Подпись" spellcheck="false" @change="save" />
          <input v-model="c.value" class="val" placeholder="size(21) · null · drop · '' · gen.text(255) · 'строка'" spellcheck="false" @change="save" />
          <button class="ib" title="Убрать" @click="(p.cases.splice(ci, 1), save())"><Icon name="x" :size="12" /></button>
        </div>
        <div class="fz-add">
          <span class="muted">Добавить:</span>
          <button @click="(p.cases.push({ label: 'Своё', value: '' }), save())">своё значение</button>
          <select title="Типовой набор — добавится строками, их можно править и убирать" value="" @change="(addSet(p, ($event.target as HTMLSelectElement).value), (($event.target as HTMLSelectElement).value = ''))">
            <option value="" disabled>типовой набор…</option>
            <option v-for="s in setsFor(p)" :key="s.id" :value="s.id" :title="s.cases.map((c) => c.label).join('\n')">{{ s.title }} ({{ s.cases.length }})</option>
          </select>
        </div>
        <p class="note muted">Значение — выражение: <code>size(21)</code> массив из 21 (из отправленных элементов), <code>size(21, (i) =&gt; i + 1)</code> свои элементы, <code>drop</code> — параметра нет, <code>null</code>, <code>''</code>, <code>gen.text(255)</code>, <code>orig</code> — что было отправлено.</p>
      </div>
    </div>

    <div class="fz-row">
      <span class="lab">Параметр</span>
      <select v-if="offered.length" title="Параметры образца запроса" value="" @change="(addParam(($event.target as HTMLSelectElement).value), (($event.target as HTMLSelectElement).value = ''))">
        <option value="" disabled>выбрать из запроса…</option>
        <option v-for="o in offered.filter((o) => !spec.params.some((p) => p.path === o.path))" :key="o.path" :value="o.path">{{ o.path }} — {{ KIND_RU[o.kind] }}: {{ o.sample }}</option>
      </select>
      <input v-model="addPath" class="path" placeholder="или путь: body.filter.ids, query.limit" spellcheck="false" @keydown.enter.prevent="addParam(addPath)" />
      <button class="pick" :disabled="!addPath.trim()" @click="addParam(addPath)"><Icon name="plus" :size="12" />добавить</button>
    </div>
  </div>
</template>

<style scoped>
.fz {
  display: flex;
  flex-basis: 100%;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  font-size: 12.5px;
}
.fz-head,
.fz-row,
.fz-ph,
.fz-add,
.fz-case {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
}
.lab {
  flex: none;
  color: var(--text-2);
}
.fz input,
.fz select {
  height: 26px;
  min-width: 0;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.req,
.found,
.path,
.val {
  flex: 1 1 200px;
  font-family: var(--font-data);
  font-size: 12px;
}
.q {
  flex: 1;
}
.num {
  width: 72px;
}
.lbl {
  width: 170px;
}
.pick,
.fz-add button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px dashed var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
}
.pick.on,
.pick:hover,
.fz-add button:hover {
  border-color: var(--accent);
  color: var(--text);
}
.fz-eps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.list {
  display: flex;
  max-height: 220px;
  flex-direction: column;
  overflow-y: auto;
}
.ep {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 6px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep:hover {
  background: var(--hover);
}
.ep .m {
  flex: none;
  width: 52px;
  color: var(--accent);
}
.ep .cnt {
  margin-left: auto;
}
.note {
  margin: 0;
  font-size: 11.5px;
  white-space: normal;
}
.note code {
  font-size: 11px;
  word-break: break-all;
}
.fz-p {
  border-top: 1px solid var(--border);
}
.fz-ph {
  height: 30px;
  cursor: pointer;
}
.fz-ph .kind {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cnt {
  flex: none;
  color: var(--text-2);
  font-size: 11.5px;
}
.fz-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 0 10px 20px;
}
.chk {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fz-add {
  flex-wrap: wrap;
  white-space: normal;
}
.ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
