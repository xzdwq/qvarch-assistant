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
const mColor = (m: string) => ({ GET: '#22c55e', POST: '#f59e0b', PUT: '#38bdf8', PATCH: '#a78bfa', DELETE: '#ef4444' })[m.toUpperCase()] ?? 'var(--text-2)'
</script>

<template>
  <div class="sw">
    <div class="sw-top">
      <button class="primary sm" :disabled="busy || !canFind" title="Посмотреть, что показывает страница, и проверить обычные адреса описания API — /v3/api-docs, /swagger.json, /openapi.json, /api-json и другие" @click="emit('find')"><Icon name="search" :size="12" />{{ busy ? 'Ищу…' : api ? 'Искать заново' : 'Найти на этом сайте' }}</button>
      <span class="grow"></span>
      <button class="ib" title="Забыть найденное описание" :disabled="!api && !error" @click="emit('clear')"><Icon name="trash" :size="13" /></button>
    </div>
    <p v-if="error" class="sw-err">{{ error }}<template v-if="tried.length"> · проверено адресов: {{ tried.length }}</template></p>
    <p v-if="err" class="sw-err">{{ err }}</p>
    <template v-if="api">
      <div class="sw-h" :title="api.url">
        <b>{{ api.info.title }}</b><span class="muted">{{ api.info.version }} · {{ api.info.kind }}</span>
      </div>
      <div class="sw-flt">
        <button :class="{ on: !only }" @click="only = false">Все <b>{{ api.info.ops.length }}</b></button>
        <button v-if="notCalled" :class="{ on: only }" title="Операции описания, которые страницы сайта ни разу не вызвали — непроверенное" @click="only = !only">Не вызывались <b>{{ notCalled.size }}</b></button>
      </div>
      <label class="sw-q"><Icon name="search" :size="12" /><input v-model="q" placeholder="Метод, путь, описание, тег" spellcheck="false" /></label>
      <div class="sw-pick">
        <label :title="allShown ? 'Снять отметку с показанных' : 'Отметить все показанные'"><input type="checkbox" :checked="allShown" :indeterminate.prop="!allShown && shown.some((o) => picked.has(o.id))" @change="setPicked(shown, !allShown)" /><span>{{ picked.size ? `Выбрано: ${picked.size}` : 'Выбрать' }}</span></label>
        <template v-if="picked.size">
          <span class="grow"></span>
          <button class="ib" :title="copied ? 'Скопировано' : 'Копировать выбранные как HTTP-блоки (с входом сайта) — вставьте в любую заметку'" @click="copyPicked"><Icon :name="copied ? 'check' : 'copy'" :size="14" /></button>
          <NotePicker class="sm" title="Выбранные операции — новой заметкой (папка «Карты API») или в конец заметки, что есть" new-label="Новая заметка (папка «Карты API»)" @pick="toNote" />
          <button class="primary sm" title="В раздел HTTP: папка с запросами, переменные для адреса и входа" @click="emit('toHttp', [...picked])">В HTTP</button>
        </template>
      </div>
      <div class="sw-list">
        <template v-for="g in groups" :key="g.tag">
          <label class="sw-tag"><input type="checkbox" :checked="g.ops.every((o) => picked.has(o.id))" @change="setPicked(g.ops, !g.ops.every((o) => picked.has(o.id)))" /><span class="tn">{{ g.tag }}</span><span class="muted">{{ g.ops.length }}</span></label>
          <label v-for="o in g.ops" :key="o.id" class="sw-op" :class="{ dep: o.deprecated }" :title="`${o.method.toUpperCase()} ${o.path}${o.summary ? ` — ${o.summary}` : ''}`">
            <input type="checkbox" :checked="picked.has(o.id)" @change="toggle(o)" />
            <b class="m" :style="{ color: mColor(o.method) }">{{ o.method.toUpperCase() }}</b>
            <code class="p">{{ o.path }}</code>
            <span v-if="o.summary" class="s">{{ o.summary }}</span>
          </label>
        </template>
        <p v-if="!shown.length" class="muted sw-none">Ничего не подходит.</p>
      </div>
    </template>
    <p v-else-if="!busy && !error" class="muted sw-none">Откройте сайт (или его Swagger UI) и нажмите «Найти»: Qvarch посмотрит, что показывает страница, и проверит обычные адреса описания API.</p>
  </div>
</template>

<style scoped>
.sw {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
}
.sw-top,
.sw-pick,
.sw-flt,
.sw-h {
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
.sw-top .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 12px;
  white-space: nowrap;
}
.sw-err {
  margin: 0;
  color: var(--down-fg);
  font-size: 12px;
}
.sw-h b,
.sw-h span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.sw-flt button {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.sw-flt button.on {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.14);
  color: var(--text);
}
.sw-q {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--field-bg);
  color: var(--muted);
}
.sw-q input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  outline: none;
}
/* the row's actions — one height */
.sw-pick > button,
.sw-pick .np {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  white-space: nowrap;
}
.sw-pick > .ib {
  justify-content: center;
  width: 28px;
  padding: 0;
}
.sw-pick label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sw-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}
.sw-tag,
.sw-op {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 28px;
  padding: 0 4px;
  white-space: nowrap;
}
.sw-tag {
  margin-top: 4px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}
.sw-tag .tn {
  overflow: hidden;
  text-overflow: ellipsis;
}
.sw-op {
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.sw-op:hover {
  background: var(--hover);
}
.sw-op.dep .p {
  text-decoration: line-through;
}
.sw-op .m {
  flex: none;
  width: 52px;
  font-family: var(--font-data);
  font-size: 11.5px;
}
.sw-op .p {
  flex: none;
  max-width: 60%;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
}
.sw-op .s {
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
}
.sw-none {
  margin: 8px 4px;
  white-space: normal;
}
</style>
