<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { parseToggle, toggleMd, type ToggleModel } from '@shared/noteBlocks'
import Icon from '../Icon.vue'

/** A fold: a title that opens / closes its text (as Notion's toggle; <details> in the file). */
const props = defineProps<{ src: string; autofocus?: boolean }>()
const emit = defineEmits<{ change: [src: string]; exit: [dir: 1 | -1] }>()
const t = ref<ToggleModel>(parseToggle(props.src))
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    t.value = parseToggle(s)
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(timer)
  const go = () => {
    const md = toggleMd(t.value)
    if (md === mine) return
    mine = md
    emit('change', md)
  }
  if (now) go()
  else timer = setTimeout(go, 250)
}
const titleEl = ref<HTMLInputElement>()
const bodyEl = ref<HTMLTextAreaElement>()
onMounted(() => props.autofocus && titleEl.value?.focus())
function onTitleKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' || (e.key === 'ArrowDown' && t.value.open)) {
    e.preventDefault()
    if (!t.value.open) {
      t.value.open = true
      save(true)
    }
    setTimeout(() => bodyEl.value?.focus())
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    emit('exit', 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    emit('exit', -1)
  }
}
function onBodyKey(e: KeyboardEvent): void {
  const el = e.target as HTMLTextAreaElement
  if (e.key === 'ArrowDown' && !el.value.slice(el.selectionEnd).includes('\n')) {
    e.preventDefault()
    emit('exit', 1)
  } else if (e.key === 'ArrowUp' && !el.value.slice(0, el.selectionStart).includes('\n')) {
    e.preventDefault()
    titleEl.value?.focus()
  }
}
</script>

<template>
  <div class="tg" :class="{ open: t.open }">
    <div class="tg-h">
      <button class="tg-ar" :title="t.open ? 'Свернуть' : 'Развернуть'" @mousedown.prevent @click="((t.open = !t.open), save(true))"><Icon name="chevronRight" :size="14" /></button>
      <input ref="titleEl" v-model="t.title" class="tg-t" placeholder="Заголовок свёртки" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onTitleKey" />
    </div>
    <textarea v-if="t.open" ref="bodyEl" v-model="t.body" class="tg-b" rows="1" placeholder="Скрытый текст" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onBodyKey"></textarea>
  </div>
</template>

<style scoped>
.tg {
  display: flex;
  flex-direction: column;
  padding: 2px 0;
}
.tg-h {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tg-ar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-2);
  transition: transform 0.12s;
}
.tg-ar:hover {
  background: var(--hover);
}
.open .tg-ar {
  transform: rotate(90deg);
}
.tg-t {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--text-hi);
  font: inherit;
  font-weight: 600;
  outline: none;
}
.tg-b {
  min-height: 0;
  margin-left: 12px;
  padding: 2px 4px 4px 14px;
  border: 0;
  border-left: 2px solid var(--border-2);
  background: transparent;
  color: var(--text);
  font: inherit;
  line-height: 1.6;
  resize: none;
  field-sizing: content;
  outline: none;
}
</style>
