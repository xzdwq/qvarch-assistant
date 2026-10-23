<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatHM } from '@shared/timeline'
import { afterEvent, sameTimesOn, type CopyPlace, type CopySource } from '@shared/tracker/entryCopy'
import type { Entry } from '@shared/types'
import Icon from '../../components/Icon.vue'
import DatePick from '../../components/DatePick.vue'
import Popover from '../../components/Popover.vue'
import TimeRange from '../../components/TimeRange.vue'
import { besidePlace } from '../../lib/usePopover'
import { errorText } from '@shared/tracker/entryForm'
import { saveCopy } from './copyEntry'

/**
 * «Копия» of an event: one button with its choices — right after the event, or on the date and at the times picked
 * (the date field and the times field of the app). The event itself stays. Opened from the button, or by the host
 * at an element (a timeline block's menu).
 */
defineOptions({ inheritAttrs: false })
/** `label` — the button's text (none — the icon alone); `noButton` — opened by the host only (`show`). */
const props = defineProps<{ day: string; source: CopySource; label?: string; disabled?: boolean; noButton?: boolean }>()
const emit = defineEmits<{ copied: [e: Entry, day: string] }>()

const W = 290
const open = ref(false)
const anchor = ref<HTMLElement>()
const place = besidePlace(W, 200, true)
/** The date and times picked for «в дату и время» (set when the menu opens: the day, right after). */
const date = ref(props.day)
const at = ref<CopyPlace>(afterEvent(props.source))
const busy = ref(false)
const error = ref('')
const after = computed(() => afterEvent(props.source))

/** The menu at an element: the date — the event's day, the times — right after it. */
function show(el: HTMLElement): void {
  anchor.value = el
  date.value = props.day
  at.value = after.value
  error.value = ''
  open.value = true
}
/** Another date: the same times of day there. */
function setDate(d: string): void {
  at.value = sameTimesOn(at.value, date.value, d)
  date.value = d
}
async function copy(day: string, p: CopyPlace): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const c = await saveCopy(day, props.source, p)
    open.value = false
    emit('copied', c, day)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
defineExpose({ show, copyAfter: () => copy(props.day, after.value) })
</script>

<template>
  <button v-if="!noButton" class="copy tw:inline-flex tw:items-center tw:gap-5 tw:[&.on]:text-accent-fg" :class="[label ? 'tw:h-28 tw:py-0 tw:px-10 tw:text-[12px] tw:[&.on]:border-accent/60' : 'tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi', { on: open }]" :disabled="disabled || busy" title="Копия события: сразу после или в другую дату и время" v-bind="$attrs" @click="show($event.currentTarget as HTMLElement)"><Icon name="copy" :size="13" /><template v-if="label">{{ label }}</template></button>
  <Popover v-model:open="open" :anchor="anchor" :place="place" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-2 tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" :style="{ width: `${W}px` }">
    <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover" :disabled="busy" @click="copy(day, after)">
      <Icon name="chevronRight" :size="13" />Сразу после этого события<span class="tw:ml-auto tw:text-muted tw:font-data tw:text-[11.5px] tw:tabular-nums">{{ formatHM(after.start) }}–{{ formatHM(after.end) }}</span>
    </button>
    <hr class="tw:my-2 tw:mx-0 tw:border-0 tw:[&&]:border-t tw:[&&]:border-t-border" />
    <div class="tw:flex tw:flex-col tw:gap-6 tw:py-4 tw:px-8">
      <span class="tw:text-text-2 tw:text-[12px]">В дату и время</span>
      <DatePick parts :model-value="date" @update:model-value="setDate" />
      <div class="tw:flex tw:items-center tw:gap-6">
        <TimeRange boxed :start="at.start" :end="at.end" @change="(r) => (at = r)" />
        <button class="primary tw:ml-auto tw:h-28 tw:py-0 tw:px-10 tw:text-[12px]" :disabled="busy || at.end <= at.start" @click="copy(date, at)">Копировать</button>
      </div>
    </div>
    <p v-if="error" class="tw:m-0 tw:px-8 tw:pb-4 tw:text-down-fg tw:text-[12px]">{{ error }}</p>
  </Popover>
</template>
