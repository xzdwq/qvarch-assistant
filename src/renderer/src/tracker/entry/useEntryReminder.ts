import { computed, ref, watch, type Ref } from 'vue'
import type { RepeatRule } from '@shared/repeat'
import type { Ms } from '@shared/types'
import type { EntryEditorProps } from './entryTypes'
import { remindModeOf, remindOf, remindShort as remindShortOf, repeatCountOf, repeatShort as repeatShortOf, seriesEvery, type RemindMode } from '@shared/tracker/entryForm'

/** The card's reminder (any event) and repeat (a new block) with their chips' labels. */
export function useEntryReminder(props: EntryEditorProps, start: Ref<Ms>) {
  const remindMode = ref<RemindMode>('off')
  const remindTime = ref(0)
  const remind = computed(() => remindOf(remindMode.value, remindTime.value))
  /** Takes the edited event's reminder. */
  function initRemind(): void {
    const r = props.entry.remind
    remindMode.value = remindModeOf(r)
    remindTime.value = r?.at ?? props.entry.start
  }
  watch(remindMode, (m) => {
    if (m === 'at' && !remindTime.value) remindTime.value = start.value
  })

  const repeatRule = ref<RepeatRule | ''>('')
  const repeatCount = ref(10)
  watch(repeatRule, (r) => r && (repeatCount.value = repeatCountOf(r)))
  const remindOpen = ref(false)
  const repeatOpen = ref(false)
  const remindShort = computed(() => remindShortOf(remindMode.value, remindTime.value))
  const repeatShort = computed(() => repeatShortOf(repeatRule.value, repeatCount.value))
  const seriesText = computed(() => seriesEvery(props.entry.series?.rule))

  return { remindMode, remindTime, remind, initRemind, repeatRule, repeatCount, remindOpen, repeatOpen, remindShort, repeatShort, seriesText }
}

export type EntryReminder = ReturnType<typeof useEntryReminder>
