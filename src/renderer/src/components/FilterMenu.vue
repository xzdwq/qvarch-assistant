<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/** A filter button: a list of options with checkboxes (a search when it is long); the button shows how many are on. */
export interface FilterOption {
  id: string
  label: string
  color?: string
  hint?: string
}
const props = defineProps<{ label: string; icon: string; options: FilterOption[]; title?: string }>()
const model = defineModel<string[]>({ default: () => [] })

const open = ref(false)
const q = ref('')
const search = ref<HTMLInputElement>()
/** The list: teleported to <body> and fixed under the button — a widget's / card's overflow never clips it. */
const btn = ref<HTMLElement>()
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? props.options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(s)) : props.options
})
function toggle(id: string): void {
  model.value = model.value.includes(id) ? model.value.filter((x) => x !== id) : [...model.value, id]
}
async function flip(): Promise<void> {
  open.value = !open.value
  q.value = ''
  if (open.value && props.options.length > 8) {
    await nextTick()
    search.value?.focus()
  }
}
</script>

<template>
  <div class="fm tw:relative">
    <button ref="btn" class="fb tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap tw:hover:not-[&.open]:not-[&.on]:bg-white/5 tw:[&.open]:not-[&.on]:bg-white/5 tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/12 tw:[&.on]:text-text-hi tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: model.length, open }" :title="title ?? label" @click="flip">
      <Icon :name="icon" :size="13" />
      <span class="fl tw:max-[900px]:hidden">{{ label }}</span>
      <b v-if="model.length" class="cnt tw:min-w-16 tw:py-0 tw:px-4 tw:rounded-[4px] tw:bg-accent tw:text-on-accent tw:text-[10.5px] tw:text-center">{{ model.length }}</b>
      <Icon name="chevronDown" :size="12" class="cv tw:text-muted" />
    </button>
    <Popover v-model:open="open" :anchor="btn" :width="260" align-left :chrome="60" max-height="none" class="fd tw:fixed tw:z-5000 tw:w-260 tw:p-6 tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)]">
      <input v-if="options.length > 8" ref="search" v-model="q" class="fs tw:w-full tw:box-border tw:mb-4 tw:py-5 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-panel tw:text-text tw:text-[12px]" placeholder="Поиск" />
      <div class="fo tw:max-h-300 tw:overflow-auto">
        <label v-for="o in shown" :key="o.id" class="opt tw:flex tw:items-center tw:gap-7 tw:py-5 tw:px-6 tw:rounded-r2 tw:text-[12.5px] tw:cursor-pointer tw:hover:bg-accent/14">
          <input class="tw:m-0 tw:[accent-color:var(--accent)]" type="checkbox" :checked="model.includes(o.id)" @change="toggle(o.id)" />
          <i class="tw:flex-none tw:w-9 tw:h-9 tw:rounded-r2" v-if="o.color" :style="{ background: o.color }"></i>
          <span class="ol tw:flex-none tw:whitespace-nowrap">{{ o.label }}</span>
          <small class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11px]" v-if="o.hint">{{ o.hint }}</small>
        </label>
        <p v-if="!shown.length" class="none tw:m-6 tw:text-muted tw:text-[12px]">Ничего</p>
      </div>
      <button v-if="model.length" class="clr tw:inline-flex tw:items-center tw:gap-5 tw:mt-4 tw:py-4 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:hover:text-text tw:hover:bg-white/6 tw:hover:enabled:border-border-3" @click="model = []"><Icon name="x" :size="12" />Сбросить</button>
    </Popover>
  </div>
</template>
