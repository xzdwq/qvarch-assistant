<script setup lang="ts">
/** What an agent did for its answer: the tools it called, folded under the answer (a click — the list). */
import { computed, ref } from 'vue'
import type { TraceLine } from '@shared/agent/agentLoop'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{ data: unknown }>()
const lines = computed(() => (Array.isArray(props.data) ? (props.data as TraceLine[]).filter((l) => l && typeof l.tool === 'string') : []))
const open = ref(false)
</script>

<template>
  <div v-if="lines.length" class="tw:mt-2 tw:min-w-0">
    <button class="tw:inline-flex tw:items-center tw:gap-4 tw:h-20 tw:py-0 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[11px] tw:hover:text-text" @click="open = !open">
      <Icon :name="open ? 'chevronDown' : 'chevronRight'" :size="11" />Шагов: {{ lines.length }}
    </button>
    <ol v-if="open" class="tw:m-0 tw:mt-2 tw:pl-18 tw:flex tw:flex-col tw:gap-2 tw:text-[11px] tw:font-data tw:text-text-2">
      <li v-for="(l, i) in lines" :key="i" class="tw:min-w-0 tw:truncate" :class="{ 'tw:text-down-fg': !l.ok }" :title="`${l.args}\n→ ${l.result}`">{{ l.tool }} {{ l.args }}</li>
    </ol>
  </div>
</template>
