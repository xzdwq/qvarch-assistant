<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * When a chain stops — one control: «error» (no answer, a script failed), whole classes of statuses (4xx, 5xx…)
 * and codes of one's own (401, 409, 400-404). The value is that list as text: "error, 4xx, 401".
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
/** The word for «no answer / a script failed» in the value. */
const ON_ERROR = 'error'
const CLASSES: readonly string[] = ['3xx', '4xx', '5xx']
const parts = computed(() => props.modelValue.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))
const own = computed(() => parts.value.filter((p) => p !== ON_ERROR && !CLASSES.includes(p)).join(', '))
function set(next: { error?: boolean; classes?: string[]; own?: string }): void {
  const error = next.error ?? parts.value.includes(ON_ERROR)
  const classes = next.classes ?? CLASSES.filter((c) => parts.value.includes(c))
  const codes = (next.own ?? own.value).split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^\d{3}(-\d{3})?$/.test(x))
  emit('update:modelValue', [...(error ? [ON_ERROR] : []), ...classes, ...codes].join(', '))
}
function toggleClass(c: string): void {
  const now = CLASSES.filter((x) => parts.value.includes(x))
  set({ classes: now.includes(c) ? now.filter((x) => x !== c) : [...now, c] })
}
const label = computed(() => {
  if (!parts.value.length) return 'никогда'
  return parts.value.map((p) => (p === ON_ERROR ? 'ошибка' : p)).join(', ')
})
const open = ref(false)
const root = ref<HTMLElement>()
const ownText = ref(own.value)
// (the popover: over everything, kept by the control)
</script>

<template>
  <span ref="root" class="sop tw:relative tw:inline-flex">
    <button class="sb tw:inline-flex tw:items-center tw:gap-6 tw:h-30 tw:py-0 tw:px-10 tw:text-[12.5px] tw:[&.on]:border-accent" :class="{ on: open }" title="Когда останавливать цепочку" @click="(open = !open), (ownText = own)">
      Остановить на: <b class="tw:text-text-hi tw:font-semibold">{{ label }}</b><Icon name="chevronDown" :size="11" />
    </button>
    <Popover v-model:open="open" :anchor="root" :width="300" align-left :chrome="0" class="sop-pop tw:flex tw:overflow-y-auto tw:flex-col tw:gap-10 tw:w-300 tw:p-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
      <label class="row tw:flex tw:items-center tw:gap-8"><input type="checkbox" :checked="parts.includes(ON_ERROR)" @change="set({ error: ($event.target as HTMLInputElement).checked })" />Ошибке — нет ответа, ошибка скрипта</label>
      <div class="cls tw:flex tw:items-center tw:gap-6">
        <span class="tw:mr-4 tw:text-text-2">Ответах</span>
        <button class="tw:py-3 tw:px-10 tw:font-data tw:text-[12px] tw:[&.on]:border-accent tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" v-for="c in CLASSES" :key="c" :class="{ on: parts.includes(c) }" @click="toggleClass(c)">{{ c }}</button>
      </div>
      <label class="own tw:flex tw:flex-col tw:gap-4 tw:text-text-2">
        Своих кодах
        <input class="tw:font-data tw:text-[12.5px]" v-model="ownText" placeholder="401, 409, 400-404" spellcheck="false" @change="set({ own: ownText })" @keydown.enter="set({ own: ownText })" />
      </label>
      <button class="never tw:self-start tw:py-3 tw:px-10 tw:text-[12px]" @click="(emit('update:modelValue', ''), (ownText = ''))">Не останавливать никогда</button>
    </Popover>
  </span>
</template>
