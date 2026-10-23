<script setup lang="ts">
import { atPoint, usePopover } from '../lib/usePopover'
import { computed, ref, shallowRef } from 'vue'
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
// it stood by a mark in the text (the text scrolled — gone); while its event is being changed it stays
const open = computed({ get: () => true, set: (on) => void (on || editing.value || emit('close')) })
const { panelRef, style } = usePopover(() => ({ x: Math.max(8, Math.min(props.x, window.innerWidth - 440)), y: Math.min(props.y + 6, window.innerHeight - 360) }), {
  place: atPoint,
  // (the form changing it has Esc then)
  esc: () => !editing.value,
}, open)
function toWork(): void {
  openEventInWork(props.day, props.id)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div :ref="panelRef" class="evc tw:fixed tw:z-1400 tw:flex tw:flex-col tw:gap-6 tw:w-420 tw:max-h-[60vh] tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:overflow-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[13px]" :style="style">
      <p v-if="missing" class="muted tw:m-0 tw:text-muted">Этого события больше нет.</p>
      <template v-else-if="entry">
        <div class="h tw:flex tw:items-center tw:gap-6" :style="{ '--c': kind?.color ?? 'var(--accent)' }">
          <span class="k tw:inline-flex tw:items-center tw:gap-6 tw:py-1 tw:px-8 tw:rounded-[10px] tw:bg-[color-mix(in_srgb,var(--c)_18%,transparent)] tw:text-(--c) tw:text-[12px]"><Icon :name="kind?.icon ?? 'tag'" :size="13" />{{ kind?.label ?? entry.kind }}</span>
          <span class="grow tw:flex-1"></span>
          <button class="x tw:inline-flex tw:w-24 tw:h-24 tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Закрыть" @click="emit('close')"><Icon name="x" :size="13" /></button>
        </div>
        <b class="t tw:text-[14.5px]">{{ entry.label || kind?.label }}</b>
        <p class="when tw:flex tw:items-center tw:gap-5 tw:m-0 tw:text-text-2 tw:text-[12.5px]">{{ dayText }} · {{ formatHM(entry.start) }}–{{ formatHM(entry.end) }} · {{ formatDuration(entry.end - entry.start) }}<template v-if="entry.outlook"> · Outlook</template></p>
        <p v-if="entry.task" class="task tw:flex tw:items-center tw:gap-5 tw:m-0 tw:text-text-2 tw:text-[12.5px]"><Icon name="jira" :size="12" /><b>{{ entry.task.key }}</b> {{ entry.task.summary }}</p>
        <p v-if="entry.description" class="desc tw:my-2 tw:mx-0 tw:py-6 tw:px-8 tw:border-l-2 tw:border-l-border-2 tw:text-text tw:whitespace-pre-wrap tw:[word-break:break-word]">{{ entry.description }}</p>
        <p v-else class="muted small tw:m-0 tw:text-muted tw:text-[12px]">Без описания</p>
        <div v-if="others.length" class="notes tw:flex tw:flex-wrap tw:items-center tw:gap-4">
          <span class="muted small tw:m-0 tw:text-muted tw:text-[12px]">Ещё в заметках:</span>
          <button v-for="p in others" :key="p" class="nl tw:inline-flex tw:items-center tw:gap-4 tw:h-22 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[11px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="(openNote(p), emit('close'))"><Icon name="note" :size="11" />{{ noteTitle(p) }}</button>
        </div>
        <div class="acts tw:flex tw:gap-6 tw:mt-4">
          <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12.5px]" v-if="!entry.outlook" @click="editing = true"><Icon name="pencil" :size="12" />Изменить</button>
          <button class="pri tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border-2 tw:rounded-[6px] tw:text-[12.5px] tw:[&&]:border-accent tw:bg-accent tw:text-on-accent" @click="toWork"><Icon name="checkSquare" :size="12" />В Моей работе</button>
        </div>
      </template>
      <p v-else class="muted tw:m-0 tw:text-muted">Загружаю…</p>
    </div>
    <EntryModal v-if="editing && entry" :day="day" :entry="entry" @close="editing = false" @changed="load" />
  </Teleport>
</template>
