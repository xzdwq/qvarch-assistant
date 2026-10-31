<script setup lang="ts">
/** A harness plan's instructions of one kind (the work's, the check's): the chosen ones' titles; a list to tick in its popover. */
import { computed, ref } from 'vue'
import type { HarnessGuide } from '@shared/agent/harness/guides'
import Popover from '@renderer/components/Popover.vue'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{ label: string; guides: HarnessGuide[] }>()
const chosen = defineModel<string[]>({ required: true })
const btn = ref<HTMLElement>()
const open = ref(false)
const titles = computed(() => chosen.value.map((id) => props.guides.find((g) => g.id === id)?.title ?? id).join(', ') || 'нет')
function toggle(id: string): void {
  chosen.value = chosen.value.includes(id) ? chosen.value.filter((x) => x !== id) : [...chosen.value, id]
}
</script>

<template>
  <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0">
    <span class="tw:flex-none tw:text-muted tw:text-[11.5px]">{{ label }}</span>
    <button ref="btn" class="tw:inline-flex tw:items-center tw:gap-4 tw:min-w-0 tw:h-22 tw:px-8 tw:rounded-full tw:text-[11.5px]" :class="{ on: open }" :title="titles" @click="open = !open">
      <span class="tw:min-w-0 tw:truncate">{{ titles }}</span><Icon name="chevronDown" :size="10" class="tw:flex-none" />
    </button>
    <Popover v-model:open="open" :anchor="btn" :width="300" align-left :chrome="0" class="tw:flex tw:flex-col tw:gap-1 tw:p-6 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" :style="{ overflowY: 'auto' }">
      <label v-for="g in guides.filter((x) => x.enabled)" :key="g.id" class="tw:flex tw:items-start tw:gap-8 tw:py-4 tw:px-6 tw:rounded-r2 tw:cursor-pointer tw:hover:bg-hover" :title="g.summary">
        <input type="checkbox" class="tw:mt-2" :checked="chosen.includes(g.id)" @change="toggle(g.id)" />
        <span class="tw:flex tw:flex-col tw:min-w-0"><b class="tw:text-[12px] tw:font-semibold">{{ g.title }}</b><span class="tw:text-muted tw:text-[11px]">{{ g.summary }}</span></span>
      </label>
      <span v-if="!guides.some((x) => x.enabled)" class="tw:p-6 tw:text-muted tw:text-[12px]">Инструкций нет — добавьте в Настройки → ИИ → Harness</span>
    </Popover>
  </div>
</template>
