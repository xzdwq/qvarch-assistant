<script setup lang="ts">
/**
 * The tables to draw, picked by hand: every table of the database — each schema its own colour (a database of several),
 * a view marked, how many columns it has —, a search over them; the found ones checked at once or all unchecked;
 * «Построить» — the picked ones (with their neighbours, if asked).
 */
import { computed, ref } from 'vue'
import { erKey, erLabel, type ErSchema } from '@shared/sql'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{ schema: ErSchema }>()
const picked = defineModel<string[]>({ required: true })
const emit = defineEmits<{ build: [] }>()
const q = ref('')
const found = computed(() => {
  const w = q.value.trim().toLowerCase()
  return props.schema.tables.filter((t) => !w || `${t.schema ?? ''}.${t.name} ${t.comment ?? ''}`.toLowerCase().includes(w))
})
const on = computed(() => new Set(picked.value))
function toggle(k: string): void {
  picked.value = on.value.has(k) ? picked.value.filter((x) => x !== k) : [...picked.value, k]
}
const pickFound = () => (picked.value = [...new Set([...picked.value, ...found.value.map(erKey)])])

/** The palette's colours (the theme's: --er-schema-1…n), taken in turn by the schemas. */
const PALETTE = 8
/** Each schema's colour (one schema only — none: nothing to tell apart). */
const schemaColor = computed(() => {
  const names = [...new Set(props.schema.tables.map((t) => t.schema ?? ''))].sort()
  return names.length > 1 ? new Map(names.map((n, i) => [n, `var(--er-schema-${(i % PALETTE) + 1})`])) : new Map<string, string>()
})
const colorOf = (s?: string) => schemaColor.value.get(s ?? '')
const BTN = 'tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:h-26 tw:px-12 tw:rounded-[13px] tw:text-[12px] tw:leading-none'
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6 tw:min-h-0 tw:h-full">
    <div class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:text-[12px] tw:whitespace-nowrap">
      <label class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:bg-field tw:text-muted tw:focus-within:border-accent"><Icon name="search" :size="12" /><input v-model="q" class="tw:w-150 tw:min-w-0 tw:border-0 tw:bg-transparent tw:text-text tw:outline-none" placeholder="Найти таблицу" spellcheck="false" /></label>
      <button class="pill" :class="BTN" :disabled="!found.length" @click="pickFound">Отметить найденные · {{ found.length }}</button>
      <button class="pill" :class="BTN" :disabled="!picked.length" @click="picked = []">Снять все</button>
      <span class="tw:flex-1"></span>
      <span class="tw:min-w-0 tw:truncate tw:text-muted">выбрано {{ picked.length }} из {{ schema.tables.length }}</span>
      <button class="primary" :class="BTN" :disabled="!picked.length" title="Построить ER по выбранным таблицам (соседи — «связи» в панели)" @click="emit('build')">Построить</button>
    </div>
    <!-- the schemas' colours -->
    <div v-if="schemaColor.size" class="tw:flex tw:flex-none tw:flex-wrap tw:gap-x-12 tw:gap-y-2 tw:text-[11.5px]">
      <span v-for="[name, color] in schemaColor" :key="name" class="tw:inline-flex tw:items-center tw:gap-4 tw:text-text-2"><i class="tw:w-8 tw:h-8 tw:rounded-r1" :style="{ background: color }"></i>{{ name || '(без схемы)' }}</span>
    </div>
    <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:grid tw:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] tw:content-start tw:gap-x-12 tw:gap-y-1">
      <label
        v-for="t in found"
        :key="erKey(t)"
        class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:h-24 tw:px-6 tw:rounded-r2 tw:cursor-pointer tw:whitespace-nowrap tw:hover:bg-hover"
        :style="colorOf(t.schema) ? { boxShadow: `inset 3px 0 0 ${colorOf(t.schema)}` } : undefined"
        :title="`${t.schema ? `${t.schema}.` : ''}${t.name} · колонок: ${t.columns.length}${t.comment ? `\n${t.comment}` : ''}`"
      >
        <input type="checkbox" :checked="on.has(erKey(t))" @change="toggle(erKey(t))" />
        <span v-if="colorOf(t.schema)" class="tw:flex-none tw:font-data tw:text-[11px]" :style="{ color: colorOf(t.schema) }">{{ t.schema }}.</span>
        <span class="tw:min-w-0 tw:truncate tw:font-data tw:text-[12px]">{{ colorOf(t.schema) ? t.name : erLabel(t, schema.defaultSchema) }}</span>
        <span v-if="t.view" class="tw:flex-none tw:px-4 tw:rounded-r1 tw:bg-white/8 tw:text-muted tw:text-[10px]">view</span>
        <span class="tw:flex-none tw:text-dim tw:text-[10.5px]">{{ t.columns.length }} кол.</span>
      </label>
      <p v-if="!found.length" class="tw:m-0 tw:text-muted tw:text-[12px]">Нет таких таблиц</p>
    </div>
  </div>
</template>
