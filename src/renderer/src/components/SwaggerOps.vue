<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiOp, ApiSpec } from '@shared/openapi'
import { specExamples } from '@shared/openapi'
import { appendToNote, blocksOf, newNote } from '../lib/apiCopy'
import { openNote } from '../lib/mentions'
import Icon from './Icon.vue'
import NotePicker from './NotePicker.vue'

/**
 * The site's Swagger / OpenAPI in «Карта API»: found on the page (what it shows, the usual addresses of a
 * description); its operations by tag — filtered, the ones the pages never called apart; the picked ones into the
 * HTTP section, into the notebook (a new note or the end of one there is), to the clipboard as ready blocks.
 */
const props = defineProps<{
  api?: { url: string; spec: unknown; info: ApiSpec }
  busy: boolean
  error: string
  tried: string[]
  /** The operations the site's pages never called (the map's own traffic compared). */
  notCalled?: Set<string>
  canFind: boolean
  /** Start on the never called ones. */
  onlyNotCalled?: boolean
}>()
const emit = defineEmits<{ find: []; clear: []; toHttp: [ids: string[]]; made: [p: { path: string; name: string }] }>()

const q = ref('')
const only = ref(!!props.onlyNotCalled)
watch(
  () => props.onlyNotCalled,
  (v) => (only.value = !!v),
)
const picked = ref(new Set<string>())
watch(
  () => props.api?.url,
  () => (picked.value = new Set()),
)
const shown = computed(() => {
  const w = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return (props.api?.info.ops ?? []).filter((o) => (!only.value || props.notCalled?.has(o.id)) && w.every((x) => `${o.method} ${o.path} ${o.summary} ${o.tag} ${o.operationId ?? ''}`.toLowerCase().includes(x)))
})
const groups = computed(() => {
  const m = new Map<string, ApiOp[]>()
  for (const o of shown.value) m.set(o.tag, [...(m.get(o.tag) ?? []), o])
  return [...m].map(([tag, ops]) => ({ tag, ops }))
})
const allShown = computed(() => shown.value.length > 0 && shown.value.every((o) => picked.value.has(o.id)))
function setPicked(ops: ApiOp[], on: boolean): void {
  const s = new Set(picked.value)
  for (const o of ops) on ? s.add(o.id) : s.delete(o.id)
  picked.value = s
}
const toggle = (o: ApiOp) => setPicked([o], !picked.value.has(o.id))

/** The description's values in the requests (as «В HTTP» is set up: defaults / examples, optional parameters). */
const opts = () => {
  try {
    return { defaults: true, optional: false, ...(JSON.parse(localStorage.getItem('qa.browser.apiOpts') ?? '{}') as object) }
  } catch {
    return { defaults: true, optional: false }
  }
}
const examples = () => (props.api ? specExamples(props.api.spec, props.api.url, [...picked.value], opts()) : [])
const copied = ref(false)
const err = ref('')
async function copyPicked(): Promise<void> {
  err.value = ''
  try {
    await navigator.clipboard.writeText(await blocksOf(examples()))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  }
}
async function toNote(path: string | null): Promise<void> {
  err.value = ''
  try {
    const xs = examples()
    if (!xs.length || !props.api) return
    let p = path
    if (p) await appendToNote(p, xs)
    else {
      const blocks = await blocksOf(xs)
      p = await newNote('Карты API', `${props.api.info.title} — ${xs.length === 1 ? `${xs[0].method} ${xs[0].url.split('?')[0].split('/').filter(Boolean).pop() ?? ''}` : `операций ${xs.length}`}`, `# ${props.api.info.title}\n\n${blocks}\n`)
    }
    picked.value = new Set()
    emit('made', { path: p, name: p.split('/').pop()!.replace(/\.md$/, '') })
    void openNote(p)
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  }
}
/** An operation's method colour (other methods — the plain text's). */
const METHOD_VAR: Record<string, string> = { GET: 'var(--api-method-get)', POST: 'var(--api-method-post)', PUT: 'var(--api-method-put)', PATCH: 'var(--api-method-patch)', DELETE: 'var(--api-method-delete)' }
const mColor = (m: string) => (Object.hasOwn(METHOD_VAR, m.toUpperCase()) ? METHOD_VAR[m.toUpperCase()] : 'var(--text-2)')
</script>

<template>
  <div class="sw tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:gap-6">
    <div class="sw-top tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <button class="primary sm tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-12 tw:whitespace-nowrap" :disabled="busy || !canFind" title="Посмотреть, что показывает страница, и проверить обычные адреса описания API — /v3/api-docs, /swagger.json, /openapi.json, /api-json и другие" @click="emit('find')"><Icon name="search" :size="12" />{{ busy ? 'Ищу…' : api ? 'Искать заново' : 'Найти на этом сайте' }}</button>
      <span class="grow tw:flex-1"></span>
      <button class="ib" title="Забыть найденное описание" :disabled="!api && !error" @click="emit('clear')"><Icon name="trash" :size="13" /></button>
    </div>
    <p v-if="error" class="sw-err tw:m-0 tw:text-down-fg tw:text-[12px]">{{ error }}<template v-if="tried.length"> · проверено адресов: {{ tried.length }}</template></p>
    <p v-if="err" class="sw-err tw:m-0 tw:text-down-fg tw:text-[12px]">{{ err }}</p>
    <template v-if="api">
      <div class="sw-h tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap" :title="api.url">
        <b class="tw:overflow-hidden tw:text-ellipsis">{{ api.info.title }}</b><span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">{{ api.info.version }} · {{ api.info.kind }}</span>
      </div>
      <div class="sw-flt tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
        <button class="tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:border-accent tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" :class="{ on: !only }" @click="only = false">Все <b>{{ api.info.ops.length }}</b></button>
        <button class="tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:border-accent tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" v-if="notCalled" :class="{ on: only }" title="Операции описания, которые страницы сайта ни разу не вызвали — непроверенное" @click="only = !only">Не вызывались <b>{{ notCalled.size }}</b></button>
      </div>
      <label class="sw-q tw:flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[6px] tw:bg-field tw:text-muted"><Icon name="search" :size="12" /><input class="tw:flex-1 tw:min-w-0 tw:border-0 tw:bg-transparent tw:text-text tw:[font:inherit] tw:outline-none" v-model="q" placeholder="Метод, путь, описание, тег" spellcheck="false" /></label>
      <div class="sw-pick tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
        <label class="tw:flex tw:items-center tw:gap-6" :title="allShown ? 'Снять отметку с показанных' : 'Отметить все показанные'"><input type="checkbox" :checked="allShown" :indeterminate.prop="!allShown && shown.some((o) => picked.has(o.id))" @change="setPicked(shown, !allShown)" /><span>{{ picked.size ? `Выбрано: ${picked.size}` : 'Выбрать' }}</span></label>
        <template v-if="picked.size">
          <span class="grow tw:flex-1"></span>
          <button class="ib tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:whitespace-nowrap tw:justify-center tw:w-28 tw:p-0" :title="copied ? 'Скопировано' : 'Копировать выбранные как HTTP-блоки (с входом сайта) — вставьте в любую заметку'" @click="copyPicked"><Icon :name="copied ? 'check' : 'copy'" :size="14" /></button>
          <NotePicker class="sm tw:[&&]:inline-flex tw:[&&]:items-center tw:[&&]:gap-5 tw:[&&]:h-28 tw:[&&]:whitespace-nowrap" title="Выбранные операции — новой заметкой (папка «Карты API») или в конец заметки, что есть" new-label="Новая заметка (папка «Карты API»)" @pick="toNote" />
          <button class="primary sm tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:whitespace-nowrap" title="В раздел HTTP: папка с запросами, переменные для адреса и входа" @click="emit('toHttp', [...picked])">В HTTP</button>
        </template>
      </div>
      <div class="sw-list tw:min-h-0 tw:flex-1 tw:overflow-y-auto">
        <template v-for="g in groups" :key="g.tag">
          <label class="sw-tag tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:h-28 tw:py-0 tw:px-4 tw:whitespace-nowrap tw:mt-4 tw:border-b tw:border-b-border tw:font-semibold"><input type="checkbox" :checked="g.ops.every((o) => picked.has(o.id))" @change="setPicked(g.ops, !g.ops.every((o) => picked.has(o.id)))" /><span class="tn tw:overflow-hidden tw:text-ellipsis">{{ g.tag }}</span><span class="muted tw:text-muted">{{ g.ops.length }}</span></label>
          <label v-for="o in g.ops" :key="o.id" class="sw-op tw:group/sw-op tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:h-28 tw:py-0 tw:px-4 tw:whitespace-nowrap tw:border-b tw:border-b-border tw:cursor-pointer tw:hover:bg-hover" :class="{ dep: o.deprecated }" :title="`${o.method.toUpperCase()} ${o.path}${o.summary ? ` — ${o.summary}` : ''}`">
            <input type="checkbox" :checked="picked.has(o.id)" @change="toggle(o)" />
            <b class="m tw:flex-none tw:w-52 tw:font-data tw:text-[11.5px]" :style="{ color: mColor(o.method) }">{{ o.method.toUpperCase() }}</b>
            <code class="p tw:group-[.dep]/sw-op:line-through tw:flex-none tw:max-w-[60%] tw:overflow-hidden tw:text-[12px] tw:text-ellipsis">{{ o.path }}</code>
            <span v-if="o.summary" class="s tw:overflow-hidden tw:text-muted tw:text-[12px] tw:text-ellipsis">{{ o.summary }}</span>
          </label>
        </template>
        <p v-if="!shown.length" class="muted sw-none tw:text-muted tw:my-8 tw:mx-4 tw:whitespace-normal">Ничего не подходит.</p>
      </div>
    </template>
    <p v-else-if="!busy && !error" class="muted sw-none tw:text-muted tw:my-8 tw:mx-4 tw:whitespace-normal">Откройте сайт (или его Swagger UI) и нажмите «Найти»: Qvarch посмотрит, что показывает страница, и проверит обычные адреса описания API.</p>
  </div>
</template>
