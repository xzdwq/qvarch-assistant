<script setup lang="ts">
/**
 * Who put a component into a shared note and when (the server's clock, shown in this computer's time zone) — a small
 * line over it. Only in shared notes, only for components put in by «@» (their origin is kept in the document).
 */
import { computed } from 'vue'
import { sharedTick, spaceOfPath } from '@nb/workspace/sharedDocs'
import { originsIn } from '@nb/workspace/sharedPlaces'

/** `line` — the line the component starts on now (counted from 1; the editor keeps it current). */
const props = defineProps<{ path: string; line: number }>()
const origin = computed(() => {
  void sharedTick.n
  return originsIn(props.path).get(props.line)
})
/** The person's name as the space knows them now (renamed since — the new one). */
const who = computed(() => {
  const o = origin.value
  return o && (spaceOfPath(props.path)?.members.find((m) => m.id === o.device)?.name ?? o.by)
})
const DAY_MS = 86_400_000
const when = computed(() => {
  const o = origin.value
  if (!o) return ''
  const d = new Date(o.at)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const today = new Date().toDateString() === d.toDateString()
  const yesterday = new Date(Date.now() - DAY_MS).toDateString() === d.toDateString()
  return today ? time : yesterday ? `вчера, ${time}` : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`
})
</script>

<template>
  <div v-if="origin" class="tw:flex tw:items-center tw:gap-4 tw:h-14 tw:mb-2 tw:text-dim tw:text-[10.5px] tw:leading-none tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis" :title="`Добавил(а) ${who} · ${new Date(origin.at).toLocaleString('ru-RU')}`">{{ who }} · {{ when }}</div>
</template>
