import { computed, ref, watch } from 'vue'
import { dayStart, MINUTE } from '@shared/timeline'
import type { EntryKind, Ms } from '@shared/types'
import type { TaskRef } from '@shared/jira'
import type { EntryAttrs } from '@shared/tracker/attributes'
import type { QuickParsed } from '../../components/QuickField.vue'
import { kinds } from '../../lib/palette'
import type { EntryEditorEmit, EntryEditorProps } from './entryTypes'

/** The event card's fields as the user edits them: times, date, text, kind, tasks; and the form's own small rules. */
export function useEntryForm(props: EntryEditorProps, emit: EntryEditorEmit) {
  const start = ref(0)
  const end = ref(0)
  const followsNow = ref(false)
  const startsNow = ref(false)
  const label = ref('')
  const kind = ref<EntryKind>('task')
  /** The Jira task this time goes to. */
  const tasks = ref<TaskRef[]>([])
  /** Its attributes' values (attribute id → value id). */
  const attrs = ref<EntryAttrs>({})
  const error = ref('')
  const busy = ref(false)
  /** "Continue that topic": what was taken. */
  const copied = ref('')
  /** What the quick line of a new event says (time, duration, day, kind, task). */
  const parsed = ref<QuickParsed>()
  const isNew = computed(() => !props.entry.id && !props.entry.outlook)
  /** An Outlook meeting is Outlook's: only a reminder can be set here. */
  const readonly = computed(() => !!props.entry.outlook)

  /**
   * The event's date. The times stay counted on `day` (the host's day) and are shifted when saved: a new event is
   * added on this date, an existing one is moved here — once the card is left, not at each wheel step.
   */
  const date = ref(props.day)
  const dayShift = () => dayStart(date.value) - dayStart(props.day)
  function setDate(d: string): void {
    if (!d || d === date.value) return
    date.value = d
    if (isNew.value) {
      // «until now» means today's now — not on another day
      followsNow.value = false
      startsNow.value = false
      emit('day', d)
    }
  }
  watch(() => parsed.value?.q.kind, (k) => k && isNew.value && (kind.value = k))
  /** A task picked with «@» joins the event's tasks. */
  function addTask(t: TaskRef): void {
    if (!tasks.value.some((x) => x.key === t.key)) tasks.value = [...tasks.value, t]
  }

  const effectiveEnd = computed(() => (followsNow.value && props.now ? props.now : end.value))
  function pushRange(): void {
    if (props.entry.id) return
    emit('range', { start: start.value, end: effectiveEnd.value, followsNow: followsNow.value })
  }
  /** From the time range: a changed side stops following "now"; the range itself keeps the start before the end. */
  function setRange(r: { start: Ms; end: Ms }): void {
    if (r.start !== start.value) startsNow.value = false
    if (r.end !== effectiveEnd.value) followsNow.value = false
    start.value = r.start
    end.value = Math.max(r.end, r.start + MINUTE)
    pushRange()
  }
  /** Kinds offered: the shown ones and the block's own (even if hidden). */
  const shown = computed(() => kinds.value.filter((x) => !x.hidden || x.id === kind.value))

  return { start, end, followsNow, startsNow, label, kind, tasks, attrs, error, busy, copied, parsed, isNew, readonly, date, dayShift, setDate, addTask, effectiveEnd, setRange, shown }
}

export type EntryForm = ReturnType<typeof useEntryForm>
