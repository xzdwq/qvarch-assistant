<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CALLOUTS, calloutMd, parseCallout, type CalloutModel } from './model'
import Icon from '@renderer/components/Icon.vue'

/** A callout: a coloured box (заметка, информация, совет, готово, внимание, опасно) with a title and text. */
const props = defineProps<{ src: string; autofocus?: boolean }>()
const emit = defineEmits<{ change: [src: string]; exit: [dir: 1 | -1] }>()
const c = ref<CalloutModel>(parseCallout(props.src))
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    c.value = parseCallout(s)
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(timer)
  const go = () => {
    const md = calloutMd(c.value)
    if (md === mine) return
    mine = md
    emit('change', md)
  }
  if (now) go()
  else timer = setTimeout(go, 250)
}
const def = computed(() => CALLOUTS.find((x) => x.id === c.value.type) ?? CALLOUTS[0])
const open = ref(false)
const bodyEl = ref<HTMLTextAreaElement>()
const titleEl = ref<HTMLInputElement>()
onMounted(() => props.autofocus && titleEl.value?.focus())
function onTitleKey(e: KeyboardEvent): void {
  switch (e.key) {
    case 'Enter':
    case 'ArrowDown':
      e.preventDefault()
      bodyEl.value?.focus()
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
    case 'Escape':
      emit('exit', 1)
      break
  }
}
</script>

<template>
  <div class="co tw:flex tw:flex-col tw:gap-2 tw:pt-8 tw:pr-12 tw:pb-10 tw:pl-12 tw:border tw:border-[color-mix(in_srgb,var(--c)_35%,transparent)] tw:[&&]:border-l-4 tw:[&&]:border-l-(--c) tw:rounded-[8px] tw:bg-[color-mix(in_srgb,var(--c)_8%,transparent)]" :style="{ '--c': def.color }">
    <div class="co-h tw:flex tw:items-center tw:gap-8">
      <button class="co-ic tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-[color-mix(in_srgb,var(--c)_18%,transparent)] tw:text-(--c) tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="`${def.title} — сменить вид`" @mousedown.prevent @click="open = !open"><Icon :name="def.icon" :size="15" /></button>
      <input ref="titleEl" v-model="c.title" class="co-t tw:flex-1 tw:min-w-0 tw:h-28 tw:py-0 tw:px-2 tw:border-0 tw:bg-transparent tw:text-(--c) tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:font-semibold tw:outline-none tw:placeholder:text-[color-mix(in_srgb,var(--c)_70%,transparent)]" :placeholder="def.title" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onTitleKey" />
    </div>
    <div v-if="open" class="co-pick tw:flex tw:flex-wrap tw:gap-4 tw:pt-4 tw:pr-0 tw:pb-6 tw:pl-34">
      <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-[color-mix(in_srgb,var(--c)_40%,transparent)] tw:rounded-[6px] tw:bg-transparent tw:text-(--c) tw:text-[12px] tw:[&.on]:bg-[color-mix(in_srgb,var(--c)_18%,transparent)]" v-for="x in CALLOUTS" :key="x.id" :class="{ on: x.id === c.type }" :style="{ '--c': x.color }" @mousedown.prevent @click="((c.type = x.id), (open = false), save(true))"><Icon :name="x.icon" :size="13" />{{ x.title }}</button>
    </div>
    <textarea ref="bodyEl" v-model="c.body" class="co-b tw:min-h-0 tw:pt-2 tw:pr-2 tw:pb-2 tw:pl-34 tw:border-0 tw:bg-transparent tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:font-[inherit] tw:[&&]:leading-[1.6] tw:resize-none tw:field-sizing-content tw:outline-none" rows="1" placeholder="Текст" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onBodyKey"></textarea>
  </div>
</template>
