<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fenceParts, fenceSrc, noteRun, publishData } from '../../lib/runbook'
import { summary } from '@shared/runbook'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'
import RunHead from './RunHead.vue'

/**
 * Data in a note (JSON / YAML): in the note's context under its name as soon as it parses — a test set for
 * a code block, a body for a request. A big one folds down to one line.
 */
const props = defineProps<{ src: string; path: string; onChange?: (src: string) => void }>()
const parts = computed(() => fenceParts(props.src))
const text = ref(parts.value.body)
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    text.value = fenceParts(s).body
  },
)
const error = ref<string>()
let timer: ReturnType<typeof setTimeout> | undefined
function write(info = fenceParts(mine).info): void {
  const src = fenceSrc(fenceParts(mine).fence, info, text.value)
  if (src === mine) return
  mine = src
  props.onChange?.(src)
}
watch(
  text,
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      write()
      const i = parts.value.info
      if (i.name) error.value = publishData(props.path, i.name, i.lang, text.value)
    }, 300)
  },
  { immediate: true },
)
const rename = (name: string | undefined) => write({ ...fenceParts(mine).info, name })
const setLang = (lang: 'json' | 'yaml') => write({ ...fenceParts(mine).info, lang })
const value = computed(() => (parts.value.info.name ? noteRun(props.path).ctx[parts.value.info.name]?.value : undefined))
// a big set starts folded
const open = ref(text.value.split('\n').length <= 15)
</script>

<template>
  <div class="bd">
    <RunHead icon="braces" kind="Данные" :name="parts.info.name" :can-run="false" name-placeholder="данные" @rename="rename">
      <span class="seg">
        <button :class="{ on: parts.info.lang === 'json' }" @mousedown.prevent @click="setLang('json')">JSON</button>
        <button :class="{ on: parts.info.lang === 'yaml' }" @mousedown.prevent @click="setLang('yaml')">YAML</button>
      </span>
      <button class="fold" :title="open ? 'Свернуть' : 'Развернуть'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" />{{ error ? 'ошибка' : summary(value) }}</button>
    </RunHead>
    <div v-if="open" class="bd-ed"><CodeArea v-model="text" :lang="parts.info.lang" :min-height="30" placeholder='[{ "id": 1, "price": 120 }]' /></div>
    <p v-if="error" class="er">{{ error }}</p>
    <p v-else-if="!parts.info.name" class="hint">Дайте имя — тогда данные доступны блокам кода, запросам и тексту.</p>
  </div>
</template>

<style scoped>
.bd {
  /* as wide as the note — long rows inside cut, never widen it */
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #4ade80;
  border-radius: 8px;
  background: var(--panel);
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  overflow: hidden;
}
.seg button {
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.fold {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.fold:hover {
  background: var(--hover);
}
.bd-ed :deep(.cm-editor) {
  max-height: 420px;
}
.er {
  margin: 0;
  color: var(--down-fg);
  font-size: 12px;
}
.hint {
  margin: 0;
  color: var(--muted);
  font-size: 11.5px;
}
</style>
