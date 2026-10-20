<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { Entry, KindDef } from '@shared/types'
import { formatDuration, formatHM } from '@shared/timeline'
import EntryModal from './EntryModal.vue'
import Icon from './Icon.vue'
import { notesOf, noteTitle, openEventInWork, openNote, refreshMentions } from '../lib/mentions'

/**
 * An event mentioned in a note, opened from its chip: what it is (kind, time, task, its description), the other
 * notes it is in; changed in the usual form («Изменить»), or opened in Моя работа.
 */
const props = defineProps<{ day: string; id: string; x: number; y: number; path?: string }>()
const emit = defineEmits<{ close: [] }>()
const entry = shallowRef<Entry>()
const missing = ref(false)
const kinds = shallowRef<KindDef[]>([])
const editing = ref(false)
async function load(): Promise<void> {
  const d = await window.qa.getDay(props.day)
  entry.value = d.entries.find((e) => e.id === props.id)
  missing.value = !entry.value
}
void load()
void window.qa.getSettings().then((s) => (kinds.value = s.kinds))
refreshMentions()
const kind = computed(() => kinds.value.find((k) => k.id === entry.value?.kind))
const dayText = computed(() => new Date(`${props.day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }))
const others = computed(() => notesOf(props.id).filter((p) => p !== props.path))
const pos = computed(() => ({ left: `${Math.max(8, Math.min(props.x, window.innerWidth - 440))}px`, top: `${Math.min(props.y + 6, window.innerHeight - 360)}px` }))
const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('.evc, .em-back') && !editing.value && emit('close')
const key = (e: KeyboardEvent) => e.key === 'Escape' && !editing.value && emit('close')
onMounted(() => {
  window.addEventListener('pointerdown', close, true)
  window.addEventListener('keydown', key)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', close, true)
  window.removeEventListener('keydown', key)
})
function toWork(): void {
  openEventInWork(props.day, props.id)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="evc" :style="pos">
      <p v-if="missing" class="muted">Этого события больше нет.</p>
      <template v-else-if="entry">
        <div class="h" :style="{ '--c': kind?.color ?? 'var(--accent)' }">
          <span class="k"><Icon :name="kind?.icon ?? 'tag'" :size="13" />{{ kind?.label ?? entry.kind }}</span>
          <span class="grow"></span>
          <button class="x" title="Закрыть" @click="emit('close')"><Icon name="x" :size="13" /></button>
        </div>
        <b class="t">{{ entry.label || kind?.label }}</b>
        <p class="when">{{ dayText }} · {{ formatHM(entry.start) }}–{{ formatHM(entry.end) }} · {{ formatDuration(entry.end - entry.start) }}<template v-if="entry.outlook"> · Outlook</template></p>
        <p v-if="entry.task" class="task"><Icon name="jira" :size="12" /><b>{{ entry.task.key }}</b> {{ entry.task.summary }}</p>
        <p v-if="entry.description" class="desc">{{ entry.description }}</p>
        <p v-else class="muted small">Без описания</p>
        <div v-if="others.length" class="notes">
          <span class="muted small">Ещё в заметках:</span>
          <button v-for="p in others" :key="p" class="nl" @click="(openNote(p), emit('close'))"><Icon name="note" :size="11" />{{ noteTitle(p) }}</button>
        </div>
        <div class="acts">
          <button v-if="!entry.outlook" @click="editing = true"><Icon name="pencil" :size="12" />Изменить</button>
          <button class="pri" @click="toWork"><Icon name="checkSquare" :size="12" />В Моей работе</button>
        </div>
      </template>
      <p v-else class="muted">Загружаю…</p>
    </div>
    <EntryModal v-if="editing && entry" :day="day" :entry="entry" @close="editing = false" @changed="load" />
  </Teleport>
</template>

<style scoped>
.evc {
  position: fixed;
  z-index: 1400;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 420px;
  max-height: 60vh;
  padding: 10px 12px 12px;
  overflow: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  font-size: 13px;
}
.h {
  display: flex;
  align-items: center;
  gap: 6px;
}
.k {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 1px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--c) 18%, transparent);
  color: var(--c);
  font-size: 12px;
}
.grow {
  flex: 1;
}
.x {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.t {
  font-size: 14.5px;
}
.when,
.task {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--text-2);
  font-size: 12.5px;
}
.desc {
  margin: 2px 0;
  padding: 6px 8px;
  border-left: 2px solid var(--border-2);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.muted {
  margin: 0;
  color: var(--muted);
}
.small {
  font-size: 12px;
}
.notes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.nl {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: 11px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.acts {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.acts button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
}
.acts .pri {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent, #fff);
}
</style>
