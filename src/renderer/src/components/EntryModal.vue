<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { DayData, Entry } from '@shared/types'
import { recentLabels } from '../lib/recent'
import EntryEditor from './EntryEditor.vue'
import { refreshMentions } from '../lib/mentions'

/** An event in a window over everything: the usual form, saved by its button. */
const props = defineProps<{ day: string; entry: Entry }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const data = shallowRef<DayData>()
void window.qa.getDay(props.day).then((d) => (data.value = d))
refreshMentions()
const title = new Date(`${props.day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="em-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:items-start tw:justify-center tw:pt-[10vh] tw:bg-black/55" @mousedown.self="emit('close')">
      <div class="em tw:w-[min(560px,calc(100vw-32px))] tw:max-h-[80vh] tw:overflow-auto tw:pt-12 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)]">
        <div class="em-h tw:flex tw:items-center tw:justify-between tw:mb-6">
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
