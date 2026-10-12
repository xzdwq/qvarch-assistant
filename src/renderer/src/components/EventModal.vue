<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { dayKey, MINUTE } from '@shared/timeline'
import { useDay } from '../lib/useDay'
import EntryEditor, { type AddPrefs, type Draft } from './EntryEditor.vue'
import Icon from './Icon.vue'

/** "В событие": a new block for today in a window over everything, its text filled in. */
const props = defineProps<{ text: string }>()
const emit = defineEmits<{ close: [] }>()

const today = ref(dayKey(Date.now()))
const { data, now } = useDay(today)
const add = ref<AddPrefs>({ from: 'now', back: false, min: 30 })
const draft = computed<Draft>(() => {
  const b = Math.floor(now.value / MINUTE) * MINUTE
  const span = add.value.min * MINUTE
  return { start: add.value.back ? b - span : b, end: add.value.back ? b : b + span, kind: 'task', label: props.text, source: 'manual', followsNow: add.value.back }
})
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="em-back" @pointerdown.self="emit('close')">
      <div class="em">
        <div class="em-head">
          <Icon name="plus" :size="13" /><span>Событие</span>
          <span class="grow"></span>
          <button class="x" title="Закрыть" @click="emit('close')"><Icon name="x" :size="14" /></button>
        </div>
        <EntryEditor
          :day="today"
          :entry="draft"
          :spans="data.spans"
          :recent="[]"
          :now="now"
          :entries="data.entries"
          :notes="data.notes"
          :links="data.links ?? []"
          :add="add"
          textarea
          @update:add="(a) => (add = a)"
          @saved="emit('close')"
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
  padding-top: 70px;
  background: rgba(5, 7, 12, 0.5);
}
.em {
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 100px);
  overflow: auto;
  padding: 12px 16px 16px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #171a24;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.em-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  color: #c3c8d6;
  font-size: 12.5px;
  font-weight: 600;
}
.grow {
  flex: 1;
}
.x {
  display: inline-flex;
  padding: 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #9aa3b8;
}
.x:hover {
  background: rgba(255, 255, 255, 0.08);
}
</style>
