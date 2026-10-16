<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { DayData, Entry } from '@shared/types'
import { recentLabels } from '../lib/recent'
import EntryEditor from './EntryEditor.vue'

/** An event in a window over everything: the usual form, saved by its button. */
const props = defineProps<{ day: string; entry: Entry }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const data = shallowRef<DayData>()
void window.qa.getDay(props.day).then((d) => (data.value = d))
const title = new Date(`${props.day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="em-back" @mousedown.self="emit('close')">
      <div class="em">
        <div class="em-h">
          <span class="cap">{{ title }}</span>
        </div>
        <EntryEditor
          v-if="data"
          :day="day"
          :entry="entry"
          :recent="recentLabels(data.entries)"
          :entries="data.entries"
          :notes="data.notes"
          :now="Date.now()"
          textarea
          manual
          @saved="(emit('changed'), emit('close'))"
          @deleted="(emit('changed'), emit('close'))"
          @close="emit('close')"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.em-back {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.55);
}
.em {
  width: min(560px, calc(100vw - 32px));
  max-height: 80vh;
  overflow: auto;
  padding: 12px 16px 16px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  box-shadow: var(--shadow), inset 0 2px 0 var(--accent);
}
.em-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
</style>
