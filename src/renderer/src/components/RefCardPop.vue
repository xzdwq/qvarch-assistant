<script setup lang="ts">
import { computed } from 'vue'
import { atPoint, usePopover } from '../lib/usePopover'
import { durText, parseNoteLink } from '@shared/noteEvents'
import { formatHM } from '@shared/timeline'
import { eventsTick, issueOf } from '../lib/noteEvents'
import { refCardOf, refWriter } from '@nb/workspace/sharedRefs'
import JiraDetails from './JiraDetails.vue'
import Icon from './Icon.vue'

/**
 * A task's card opened from its chip (this person's Jira, else the shared note's snapshot: the description for
 * everyone), or the card of someone else's event (its snapshot, read only).
 */
const props = defineProps<{ path: string; url: string; x: number; y: number; from?: HTMLElement }>()
const emit = defineEmits<{ close: [] }>()
const link = computed(() => parseNoteLink(props.url))
const card = computed(() => {
  void eventsTick.value
  return refCardOf(props.path, props.url)
})
const issue = computed(() => {
  void eventsTick.value
  const l = link.value
  if (l?.kind !== 'jira') return undefined
  const own = issueOf(l.key)
  if (own) return own
  return card.value?.kind === 'jira' ? { ...card.value.issue, mine: false } : undefined
})
const event = computed(() => (card.value?.kind === 'event' ? card.value.event : undefined))
/** Shown from the snapshot: whose and when. */
const source = computed(() => {
  const c = card.value
  if (!c || (link.value?.kind === 'jira' && issueOf(link.value.key))) return ''
  const who = refWriter(props.path, c) ?? 'участника'
  return `по данным ${who}, ${new Date(c.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
})
const dayText = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
const open = computed({ get: () => true, set: (on) => void (on || emit('close')) })
const { panelRef, style } = usePopover(() => ({ x: Math.max(8, Math.min(props.x, window.innerWidth - 460)), y: Math.min(props.y + 6, window.innerHeight - 380), from: props.from }), { place: atPoint }, open)
</script>

<template>
  <Teleport to="body">
    <div :ref="panelRef" class="refc tw:fixed tw:z-1400 tw:flex tw:flex-col tw:gap-6 tw:w-440 tw:max-h-[70vh] tw:overflow-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[13px]" :style="style">
      <div class="h tw:flex tw:items-center tw:gap-6 tw:pt-10 tw:px-12">
        <template v-if="issue">
          <Icon name="jira" :size="13" />
          <b class="tw:min-w-0 tw:truncate tw:text-[14px]"><span class="tw:font-data">{{ issue.key }}</span> {{ issue.summary }}</b>
        </template>
        <template v-else-if="event">
          <span class="k tw:inline-flex tw:items-center tw:gap-6 tw:py-1 tw:px-8 tw:rounded-[10px] tw:bg-[color-mix(in_srgb,var(--c)_18%,transparent)] tw:text-(--c) tw:text-[12px] tw:whitespace-nowrap" :style="{ '--c': event.kind.color || 'var(--accent)' }"><Icon :name="event.kind.icon" :size="13" />{{ event.kind.label }}</span>
          <b class="tw:min-w-0 tw:truncate tw:text-[14px]">{{ event.label }}</b>
        </template>
        <span class="tw:flex-1"></span>
        <button class="x tw:inline-flex tw:w-24 tw:h-24 tw:flex-none tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover" title="Закрыть" @click="emit('close')"><Icon name="x" :size="13" /></button>
      </div>
      <p v-if="source" class="src tw:m-0 tw:px-12 tw:text-muted tw:text-[11.5px] tw:truncate">{{ source }}</p>
      <JiraDetails v-if="issue" :issue="issue" :url="card?.kind === 'jira' ? card.url : undefined" />
      <div v-else-if="event" class="tw:flex tw:flex-col tw:gap-6 tw:px-12 tw:pb-12">
        <p class="when tw:m-0 tw:text-text-2 tw:text-[12.5px]">{{ dayText(event.day) }} · {{ formatHM(event.start) }}–{{ formatHM(event.end) }} · {{ durText(event.end - event.start) }}<template v-if="event.outlook"> · Outlook</template></p>
        <div v-if="event.attrs?.length" class="tw:flex tw:flex-wrap tw:gap-4">
          <span v-for="a in event.attrs" :key="a.id" class="tw:py-1 tw:px-7 tw:rounded-r2 tw:font-data tw:text-[11px] tw:bg-[color-mix(in_srgb,var(--attr)_18%,transparent)] tw:text-(--attr)" :style="{ '--attr': a.color }">{{ a.name }}: {{ a.value }}</span>
        </div>
        <p v-if="event.task" class="task tw:flex tw:items-center tw:gap-5 tw:m-0 tw:text-text-2 tw:text-[12.5px]"><Icon name="jira" :size="12" /><b>{{ event.task.key }}</b> {{ event.task.summary }}</p>
        <p v-if="event.description" class="desc tw:my-2 tw:mx-0 tw:py-6 tw:px-8 tw:border-l-2 tw:border-l-border-2 tw:text-text tw:whitespace-pre-wrap tw:[word-break:break-word]">{{ event.description }}</p>
        <p v-else class="tw:m-0 tw:text-muted tw:text-[12px]">Без описания</p>
      </div>
      <p v-else class="tw:m-0 tw:px-12 tw:pb-12 tw:text-muted">Нет данных: их добавит участник, у которого это есть, когда откроет заметку.</p>
    </div>
  </Teleport>
</template>
