<script setup lang="ts">
import { computed } from 'vue'
import { offeredAttrs, optionLabel, type EntryAttrs } from '@shared/tracker/attributes'
import { attrDefs } from '../../lib/attributes'

/**
 * An event's attributes to set: a row each — its letters in its colour, its name (whole), a value or «—» (none).
 * The active attributes and any the event has though turned off. Used by the card and by a timeline block's menu.
 */
const attrs = defineModel<EntryAttrs>({ required: true })
const offered = computed(() => offeredAttrs(attrDefs.value, attrs.value))
/** A value picked ('' — the attribute taken off). */
function set(id: string, value: string): void {
  const next = { ...attrs.value }
  if (value) next[id] = value
  else delete next[id]
  attrs.value = next
}
</script>

<template>
  <div class="tw:grid tw:grid-cols-[auto_auto_minmax(130px,1fr)] tw:items-center tw:gap-x-8 tw:gap-y-6 tw:text-[12.5px]">
    <template v-for="d in offered" :key="d.id">
      <i class="tw:inline-flex tw:items-center tw:justify-center tw:min-w-30 tw:h-20 tw:px-4 tw:rounded-r1 tw:not-italic tw:font-data tw:text-[10px] tw:font-bold tw:text-text-hi" :style="{ background: d.color }">{{ d.short }}</i>
      <span class="tw:whitespace-nowrap tw:[&.off]:text-muted" :class="{ off: !d.active }" :title="d.active ? '' : 'Выключен: остаётся у этого события, новым не предлагается'">{{ d.name }}</span>
      <select class="tw:h-30 tw:min-w-0 tw:text-[12px]" :value="attrs[d.id] ?? ''" @change="set(d.id, ($event.target as HTMLSelectElement).value)">
        <option value="">—</option>
        <option v-for="o in d.options" :key="o.id" :value="o.id">{{ o.label }}</option>
        <option v-if="attrs[d.id] && !d.options.some((o) => o.id === attrs[d.id])" :value="attrs[d.id]">{{ optionLabel(d, attrs[d.id]) }}</option>
      </select>
    </template>
    <p v-if="!offered.length" class="tw:col-span-3 tw:m-0 tw:text-muted tw:text-[12px]">Атрибутов нет — их заводят в «Настройки → Атрибуты».</p>
  </div>
</template>
