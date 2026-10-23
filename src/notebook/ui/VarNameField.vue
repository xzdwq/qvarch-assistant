<script setup lang="ts">
/**
 * A block's variable name as the note writes it — {{ name }}: typed into, taken when the field is left (Enter
 * leaves it, Esc drops what was typed). One look for every block that publishes a value (runnable blocks, tables).
 */
withDefaults(defineProps<{ bad?: boolean; title?: string; placeholder?: string }>(), { placeholder: 'имя' })
const emit = defineEmits<{ commit: []; cancel: [] }>()
const draft = defineModel<string>({ required: true })
</script>

<template>
  <label class="rn tw:inline-flex tw:flex-none tw:items-center tw:h-24 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-dim tw:font-data tw:[&.bad]:border-down" :class="{ bad }" :title="title">
    <span>{{ '{' }}{{ '{' }}</span><input class="tw:w-110 tw:h-22 tw:py-0 tw:px-3 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:leading-[inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:outline-none" v-model="draft" spellcheck="false" :placeholder="placeholder" @blur="emit('commit')" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" @keydown.esc.stop.prevent="(emit('cancel'), ($event.target as HTMLInputElement).blur())" /><span>{{ '}' }}{{ '}' }}</span>
  </label>
</template>
