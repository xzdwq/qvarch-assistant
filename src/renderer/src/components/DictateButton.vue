<script setup lang="ts">
import { fmtSec, useRecorder, type Dictation } from '../lib/recorder'
import Icon from './Icon.vue'

/**
 * Dictate the description of a block: one click starts, the next one stops and hands the recording
 * to the parent (it saves the block, links the audio to it and transcribes it in the background).
 */
/** `square` — the card's row of small square buttons. */
defineProps<{ compact?: boolean; square?: boolean }>()
const emit = defineEmits<{ recorded: [r: Dictation] }>()
const { rec, sec, level, error, start, stop } = useRecorder()

async function toggle(): Promise<void> {
  if (!rec.value) {
    await start('voice')
    return
  }
  const r = await stop()
  if (r) emit('recorded', r)
}
</script>

<template>
  <button
    class="dict tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:gap-6 tw:min-w-36 tw:h-36 tw:box-border tw:py-0 tw:px-10 tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:text-muted tw:cursor-pointer tw:hover:not-[&.on]:text-down-fg tw:hover:not-[&.on]:border-down/50 tw:[&.on]:bg-down tw:[&.on]:border-down tw:[&.on]:text-text-hi tw:[&.compact]:h-30 tw:[&.compact]:min-w-30 tw:[&.compact]:py-0 tw:[&.compact]:px-8 tw:[&&]:[&.sq]:h-26 tw:[&&]:[&.sq]:min-w-26 tw:[&&]:[&.sq]:px-6 tw:hover:enabled:not-[&.on]:bg-hover"
    :class="{ on: !!rec, compact, sq: square }"
    :title="error || (rec ? 'Остановить' : 'Надиктовать описание')"
    @click="toggle"
  >
    <Icon :name="rec ? 'stop' : 'mic'" :size="compact || square ? 13 : 15" />
    <template v-if="rec">
      <span class="lv tw:inline-flex tw:items-end tw:w-4 tw:h-14 tw:rounded-[2px] tw:bg-white/30 tw:overflow-hidden"><span class="tw:w-full tw:bg-text-hi" :style="{ height: `${20 + level * 80}%` }"></span></span>
      <b class="tw:tabular-nums tw:font-data tw:text-[12px]">{{ fmtSec(sec) }}</b>
    </template>
  </button>
</template>
