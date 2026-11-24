<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from '../../../components/Icon.vue'

/**
 * A part of the inspector's panel that folds: its title, a short line beside it (one line — cut when narrow), its
 * own buttons at the right; open or folded remembered by its key.
 */
const props = defineProps<{ id: string; title: string; note?: string }>()
const KEY = `qa.inspect.fold.${props.id}`
const read = () => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}
const open = ref(read())
watch(open, (v) => {
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    // fine
  }
})
</script>

<template>
  <section class="tw:flex tw:flex-col tw:min-w-0 tw:border-b tw:border-b-border">
    <div class="tw:sticky tw:top-0 tw:z-2 tw:flex tw:items-center tw:gap-6 tw:h-30 tw:pr-8 tw:bg-panel tw:min-w-0">
      <button class="tw:flex tw:flex-1 tw:min-w-0 tw:items-center tw:gap-6 tw:h-full tw:pl-8 tw:border-0 tw:bg-transparent tw:text-left tw:hover:bg-hover" :title="open ? 'Свернуть' : 'Развернуть'" @click="open = !open">
        <Icon :name="open ? 'chevronDown' : 'chevronRight'" :size="11" class="tw:flex-none tw:text-muted" />
        <b class="tw:flex-none tw:text-[12.5px] tw:text-text-hi tw:whitespace-nowrap">{{ title }}</b>
        <span v-if="note" class="tw:min-w-0 tw:truncate tw:text-[11.5px] tw:text-muted">{{ note }}</span>
      </button>
      <slot name="tools" />
    </div>
    <div v-if="open" class="tw:flex tw:flex-col tw:min-w-0"><slot /></div>
  </section>
</template>
