<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { parseToggle, toggleMd, type ToggleModel } from './model'
import Icon from '@renderer/components/Icon.vue'

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
/** Into the text (Enter opens a closed fold; ↓ only an open one), else out of the block. */
function enterBody(): void {
  if (!t.value.open) {
    t.value.open = true
    save(true)
  }
  setTimeout(() => bodyEl.value?.focus())
}
function onTitleKey(e: KeyboardEvent): void {
  switch (e.key) {
    case 'Enter':
      e.preventDefault()
      enterBody()
      break
    case 'ArrowDown':
      e.preventDefault()
      if (t.value.open) enterBody()
      else emit('exit', 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      emit('exit', -1)
      break
  }
}
// arrows leave the text only from its first / last line
function onBodyKey(e: KeyboardEvent): void {
  const el = e.target as HTMLTextAreaElement
  switch (e.key) {
    case 'ArrowDown':
      if (el.value.slice(el.selectionEnd).includes('\n')) return
      e.preventDefault()
      emit('exit', 1)
      break
    case 'ArrowUp':
      if (el.value.slice(0, el.selectionStart).includes('\n')) return
      e.preventDefault()
      titleEl.value?.focus()
      break
  }
}
</script>

<template>
  <div class="tg tw:group/tg tw:flex tw:flex-col tw:py-2 tw:px-0" :class="{ open: t.open }">
    <div class="tg-h tw:flex tw:items-center tw:gap-4">
      <button class="tg-ar tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:[transition:transform_0.12s] tw:hover:bg-hover tw:group-[.open]/tg:[transform:rotate(90deg)] tw:hover:enabled:border-border-3" :title="t.open ? 'Свернуть' : 'Развернуть'" @mousedown.prevent @click="((t.open = !t.open), save(true))"><Icon name="chevronRight" :size="14" /></button>
      <input ref="titleEl" v-model="t.title" class="tg-t tw:flex-1 tw:min-w-0 tw:h-28 tw:py-0 tw:px-2 tw:border-0 tw:bg-transparent tw:text-text-hi tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:font-semibold tw:outline-none" placeholder="Заголовок свёртки" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onTitleKey" />
    </div>
    <textarea v-if="t.open" ref="bodyEl" v-model="t.body" class="tg-b tw:min-h-0 tw:ml-12 tw:pt-2 tw:pr-4 tw:pb-4 tw:pl-14 tw:border-0 tw:[&&]:border-l-2 tw:[&&]:border-l-border-2 tw:bg-transparent tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:font-[inherit] tw:[&&]:leading-[1.6] tw:resize-none tw:field-sizing-content tw:outline-none" rows="1" placeholder="Скрытый текст" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onBodyKey"></textarea>
  </div>
</template>
