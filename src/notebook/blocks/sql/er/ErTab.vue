<script setup lang="ts">
/**
 * An ER diagram in a tab of its own: the one moved here from a query block (as it was), or — the tab kept from before
 * the app's restart — what it was built of and «Построить» (nothing is read from the database until it is pressed).
 */
import { computed } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import { erTabOf } from '@nb/workspace/viewTabs'
import { erOfTab } from './erTabs'
import SqlEr from './SqlEr.vue'

/** (a view tab's pane and path — every view gets them) */
const props = defineProps<{ path: string; pi?: number }>()
const er = computed(() => erOfTab(props.path))
const db = computed(() => erTabOf(props.path).db)
const MODE_WORD = { query: 'по таблицам запроса', picked: 'по выбранным таблицам', all: 'вся база' } as const
</script>

<template>
  <div class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:bg-bg">
    <SqlEr v-if="er.phase.value !== 'idle'" :er="er" in-tab />
    <div v-else class="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:text-[12.5px] tw:text-muted">
      <Icon name="database" :size="26" />
      <span>ER-диаграмма · подключение <b class="tw:text-text">{{ db }}</b> · {{ MODE_WORD[er.mode.value] }}<template v-if="er.mode.value === 'picked'"> ({{ er.picked.value.length }})</template></span>
      <button class="primary tw:inline-flex tw:items-center tw:justify-center tw:h-28 tw:px-14 tw:rounded-[14px] tw:text-[12.5px] tw:leading-none" title="Прочитать структуру базы (только чтение) и построить схему" @click="er.rebuild()">Построить</button>
    </div>
  </div>
</template>
