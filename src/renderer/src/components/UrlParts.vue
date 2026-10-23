<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildUrl, parseUrl, type UrlParam, type UrlParts } from '@shared/urlParts'
import { placeFloat, useAnchor } from '../lib/floating'
import Icon from './Icon.vue'

/**
 * The address in parts (the arrow beside the address line): the whole address as text, and its scheme, host, path,
 * query parameters (on / off, key, value — readable), the part after # with a router's parameters; opened here or
 * in a new tab. Text and parts follow each other.
 */
const props = defineProps<{ url: string; anchor: HTMLElement | undefined }>()
const emit = defineEmits<{ open: [url: string, newTab: boolean]; close: [] }>()

const parts = ref<UrlParts>(parseUrl(props.url))
const text = ref(props.url)
// the parts edited → the text built; the text edited → the parts read (the one typed into is not rewritten)
let fromText = false
watch(
  parts,
  (p) => {
    if (fromText) return
    text.value = buildUrl(p)
  },
  { deep: true },
)
function onText(v: string): void {
  text.value = v
  fromText = true
  parts.value = parseUrl(v)
  void nextTick(() => (fromText = false))
}
const changed = computed(() => text.value.trim() !== props.url)
const reset = () => onText(props.url)
const add = (list: UrlParam[]) => list.push({ key: '', value: '', on: true })
const open = (newTab = false) => text.value.trim() && emit('open', text.value.trim(), newTab)
const copied = ref(false)
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(text.value.trim())
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

// ---------- placed under the address line (a popover of the window — over the page) ----------
const pop = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
// (turned on once mounted: the anchoring starts on the change — placed from the first frame)
const shown = ref(false)
const anchorRef = computed(() => props.anchor)
useAnchor(shown, anchorRef, () => {
  if (!props.anchor) return
  const w = Math.max(560, Math.min(860, props.anchor.getBoundingClientRect().width))
  const f = placeFloat(props.anchor, w, true, 0)
  style.value = { ...f.style, maxHeight: `${Math.max(f.maxH, 320)}px` }
})
const away = (e: PointerEvent) => {
  const t = e.target as Node
  if (!pop.value?.contains(t) && !props.anchor?.contains(t)) emit('close')
}
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close')
onMounted(() => {
  shown.value = true
  window.addEventListener('pointerdown', away, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => (window.removeEventListener('pointerdown', away, true), window.removeEventListener('keydown', onKey)))
const rows = (v: string) => Math.min(6, Math.max(1, Math.ceil(v.length / 60), v.split('\n').length))
</script>

<template>
  <Teleport to="body">
    <div ref="pop" class="up" :style="style" @keydown.enter.exact.prevent="open()" @keydown.ctrl.enter.prevent="open(true)">
      <label class="up-all">
        <span>Адрес</span>
        <textarea :value="text" :rows="rows(text)" spellcheck="false" @input="onText(($event.target as HTMLTextAreaElement).value)" @keydown.enter.exact.prevent.stop="open()"></textarea>
      </label>
      <div class="up-grid">
        <label>
          <span>Протокол</span>
          <select v-model="parts.scheme"><option value="https">https</option><option value="http">http</option><option v-if="!['http', 'https'].includes(parts.scheme)" :value="parts.scheme">{{ parts.scheme }}</option></select>
        </label>
        <label class="grow"><span>Хост (и порт)</span><input v-model="parts.host" spellcheck="false" /></label>
        <label class="wide"><span>Путь</span><input v-model="parts.path" spellcheck="false" /></label>
      </div>

      <template v-for="sec in [{ title: 'Параметры запроса (после ?)', list: parts.params }, ...(parts.hash || parts.hashParams.length ? [{ title: 'Параметры после #', list: parts.hashParams }] : [])]" :key="sec.title">
        <div class="up-h">
          <b>{{ sec.title }}</b>
          <span class="muted">{{ sec.list.filter((x) => x.on).length }} из {{ sec.list.length }}</span>
          <span class="grow"></span>
          <button class="lnk" @click="add(sec.list)"><Icon name="plus" :size="12" />параметр</button>
        </div>
        <p v-if="!sec.list.length" class="muted none">Нет параметров</p>
        <div v-for="(p, i) in sec.list" :key="i" class="up-p" :class="{ off: !p.on }">
          <input v-model="p.on" type="checkbox" :title="p.on ? 'Выключить (не уйдёт в адрес)' : 'Включить'" />
          <input v-model="p.key" class="k" placeholder="ключ" spellcheck="false" />
          <span class="eq">=</span>
          <textarea v-model="p.value" class="v" :rows="rows(p.value)" placeholder="значение" spellcheck="false" @keydown.enter.exact.prevent.stop="open()"></textarea>
          <button class="ib" title="Удалить параметр" @click="sec.list.splice(i, 1)"><Icon name="x" :size="12" /></button>
        </div>
      </template>
      <label v-if="parts.hash || parts.hashParams.length" class="up-hash"><span>После #</span><input v-model="parts.hash" spellcheck="false" placeholder="#/маршрут" /></label>
      <button v-else class="lnk add-hash" @click="parts.hash = '#'"><Icon name="plus" :size="12" />часть после #</button>

      <div class="up-acts">
        <button class="primary" :disabled="!text.trim()" title="Открыть в этой вкладке (Enter)" @click="open()"><Icon name="play" :size="11" />Открыть</button>
        <button :disabled="!text.trim()" title="Открыть в новой вкладке (Ctrl+Enter)" @click="open(true)"><Icon name="plus" :size="12" />В новой вкладке</button>
        <button title="Скопировать адрес" @click="copy"><Icon name="copy" :size="12" />{{ copied ? 'Скопировано' : 'Копировать' }}</button>
        <span class="grow"></span>
        <button v-if="changed" class="lnk" title="Вернуть адрес страницы" @click="reset">сбросить</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.up {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  overflow-y: auto;
  font-size: 12.5px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
label > span {
  color: var(--muted);
  font-size: 11.5px;
}
input:not([type='checkbox']),
select,
textarea {
  min-width: 0;
  padding: 4px 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
textarea,
.up-grid input,
.up-p .k {
  font-family: var(--font-data);
  font-size: 12px;
}
textarea {
  resize: vertical;
  word-break: break-all;
}
.up-grid {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 6px 8px;
}
.up-grid .wide {
  grid-column: 1 / -1;
}
.up-h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  white-space: nowrap;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
}
.none {
  margin: 0;
}
.up-p {
  display: grid;
  grid-template-columns: auto minmax(90px, 30%) auto 1fr auto;
  align-items: start;
  gap: 6px;
}
.up-p > input[type='checkbox'] {
  margin-top: 6px;
}
.up-p .eq {
  margin-top: 4px;
  color: var(--muted);
}
.up-p.off .k,
.up-p.off .v {
  opacity: 0.5;
  text-decoration: line-through;
}
.up-hash {
  margin-top: 2px;
}
.lnk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  white-space: nowrap;
}
.add-hash {
  align-self: flex-start;
}
.ib {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 26px;
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
.up-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.up-acts button:not(.lnk) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  white-space: nowrap;
}
</style>
