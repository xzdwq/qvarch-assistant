<script setup lang="ts">
import { fmtSec, useRecorder } from '../lib/recorder'
import Icon from './Icon.vue'

/**
 * Dictate the description of a block: one click starts, the next one stops and hands the recording
 * to the parent (it saves the block, links the audio to it and transcribes it in the background).
 */
defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ recorded: [r: { blob: Blob; durationSec: number; at: number; kind: 'voice' | 'call' }] }>()
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
    class="dict"
    :class="{ on: !!rec, compact }"
    :title="error || (rec ? 'Остановить' : 'Надиктовать описание')"
    @click="toggle"
  >
    <Icon :name="rec ? 'stop' : 'mic'" :size="compact ? 13 : 15" />
    <template v-if="rec">
      <span class="lv"><span :style="{ height: `${20 + level * 80}%` }"></span></span>
      <b>{{ fmtSec(sec) }}</b>
    </template>
  </button>
</template>

<style scoped>
.dict {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 36px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--muted);
  cursor: pointer;
}
.dict:hover {
  color: var(--down-fg);
  border-color: rgba(255, 61, 61, 0.5);
}
.dict.on {
  background: var(--down);
  border-color: var(--down);
  color: var(--text-hi);
}
.dict.compact {
  height: 30px;
  min-width: 30px;
  padding: 0 8px;
}
.lv {
  display: inline-flex;
  align-items: flex-end;
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}
.lv span {
  width: 100%;
  background: var(--text-hi);
}
b {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  font-size: 12px;
}
</style>
