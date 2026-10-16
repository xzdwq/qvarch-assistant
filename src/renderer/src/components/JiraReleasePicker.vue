<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { JiraVersion } from '@shared/jira'
import { placeFloat, useAnchor } from '../lib/floating'
import Icon from './Icon.vue'

/**
 * A Jira release (a fix version of any project in the settings): the unreleased ones first, then — after a
 * divider — the released, page by page as the list scrolls; a search over them. × — forget the picked one.
 */
const props = defineProps<{ modelValue?: JiraVersion; busy?: boolean; info?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: JiraVersion | undefined] }>()

const open = ref(false)
const q = ref('')
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const pop = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
const maxH = ref(320)
useAnchor(open, root, () => {
  if (!root.value) return
  const f = placeFloat(root.value, 380, true, 60)
  style.value = f.style
  maxH.value = f.maxH
})

const items = shallowRef<JiraVersion[]>([])
const total = ref(0)
const unreleased = ref(0)
const loading = ref(false)
const error = ref('')
let seq = 0
async function load(reset: boolean): Promise<void> {
  if (!reset && (loading.value || items.value.length >= total.value)) return
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await window.qa.jiraVersions(q.value, reset ? 0 : items.value.length, 40)
    if (my !== seq) return
    items.value = reset ? r.items : [...items.value, ...r.items]
    total.value = r.total
    unreleased.value = r.unreleased
  } catch (e) {
    if (my === seq) error.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  } finally {
    if (my === seq) loading.value = false
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(() => void load(true), 180)
})
async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  q.value = ''
  void load(true)
  await nextTick()
  input.value?.focus({ preventScroll: true })
}
function onScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight > el.scrollHeight - 120) void load(false)
}
function pick(v: JiraVersion): void {
  open.value = false
  emit('update:modelValue', v)
}
const date = (d?: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : '')
function onDown(e: PointerEvent): void {
  const t = e.target as Node
  if (open.value && !root.value?.contains(t) && !pop.value?.contains(t)) open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  } else if (e.key === 'Enter' && items.value[0]) pick(items.value[0])
}
onMounted(() => document.addEventListener('pointerdown', onDown, true))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDown, true)
  clearTimeout(timer)
})
</script>

<template>
  <span ref="root" class="jrp" :class="{ on: !!modelValue }">
    <button class="jrb" :class="{ open }" :title="modelValue ? `Релиз ${modelValue.project} · ${modelValue.name}` : 'Отметить ветки задач релиза Jira'" @click="toggle">
      <Icon name="jira" :size="12" />
      <template v-if="modelValue"><b>{{ modelValue.project }}</b>{{ modelValue.name }}</template>
      <template v-else>Релиз Jira</template>
      <Icon name="chevronDown" :size="11" />
    </button>
    <button v-if="modelValue" class="jrx" title="Сбросить релиз (отмеченные ветки остаются)" @click="emit('update:modelValue', undefined)"><Icon name="x" :size="11" /></button>
    <span v-if="busy" class="jri">задачи релиза…</span>
    <span v-else-if="info" class="jri">{{ info }}</span>
  </span>
  <Teleport to="body">
    <div v-if="open" ref="pop" class="jr-pop" :style="style">
      <div class="sbox">
        <Icon name="search" :size="13" />
        <input ref="input" v-model="q" placeholder="Найти релиз: проект, версия" spellcheck="false" @keydown="onKey" />
      </div>
      <div class="items" :style="{ maxHeight: `${maxH}px` }" @scroll.passive="onScroll">
        <template v-for="(v, i) in items" :key="v.id">
          <div v-if="i === 0 && unreleased" class="div">Невыпущенные · {{ unreleased }}</div>
          <div v-if="i === unreleased" class="div">Выпущенные · {{ total - unreleased }}</div>
          <button class="it" :class="{ cur: modelValue?.id === v.id, rel: v.released }" @click="pick(v)">
            <b>{{ v.project }}</b>
            <span class="nm">{{ v.name }}</span>
            <span v-if="v.releaseDate" class="dt">{{ date(v.releaseDate) }}</span>
          </button>
        </template>
        <p v-if="loading && !items.length" class="empty">Загрузка релизов…</p>
        <p v-else-if="error" class="empty err">{{ error }}</p>
        <p v-else-if="!items.length" class="empty">Релизов не найдено</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.jrp {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.jrb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
.jrb > svg:first-child {
  color: var(--info);
}
.jrb b {
  font-family: var(--font-data);
  font-size: 11px;
  color: var(--info-fg);
}
.jrp.on .jrb,
.jrb.open {
  border-color: var(--accent-line);
  color: var(--text-hi);
}
.jrx {
  display: inline-flex;
  padding: 5px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.jrx:hover {
  color: var(--down-fg);
}
.jri {
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11.5px;
}
.jr-pop {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.sbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
}
.sbox input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
}
.items {
  overflow-y: auto;
  padding: 4px;
}
.div {
  margin: 6px 6px 3px;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.it {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
}
.it:hover {
  background: var(--hover);
}
.it.cur {
  background: var(--accent-soft);
}
.it.rel {
  color: var(--text-2);
}
.it b {
  flex: none;
  width: 34px;
  color: var(--info-fg);
  font-family: var(--font-data);
  font-size: 11px;
}
.nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dt {
  flex: none;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.empty {
  margin: 10px;
  color: var(--muted);
  font-size: 12px;
}
.empty.err {
  color: var(--down-fg);
}
</style>
