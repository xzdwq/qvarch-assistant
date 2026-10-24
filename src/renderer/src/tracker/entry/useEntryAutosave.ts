import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { joinTitle } from '@shared/timeline'
import type { Ms } from '@shared/types'
import type { Dictation, EntryEditorEmit, EntryEditorProps } from './entryTypes'
import type { EntryForm } from './useEntryForm'
import type { EntryReminder } from './useEntryReminder'

/**
 * The card in sync with its event: the form re-inits when another event opens, takes changes from outside (a reload,
 * the host moving the event) unless the user changed that part, and an existing event saves itself when the card
 * is left — not at each step (a date could take it away).
 */
export function useEntryAutosave(
  props: EntryEditorProps,
  emit: EntryEditorEmit,
  form: EntryForm,
  rem: EntryReminder,
  actions: { save: (dict?: Dictation, auto?: boolean) => Promise<boolean>; forgetSeriesScope: () => void },
  /** The card's element: a press / focus outside it (but in the app) is leaving it. */
  rootEl: Ref<HTMLElement | undefined>,
) {
  const { start, end, followsNow, startsNow, label, kind, tasks, attrs, error, busy, copied, date } = form
  // the autosave's state (declared before the watchers below use it)
  let savedKey = ''
  const saveState = ref<'idle' | 'pending' | 'saving' | 'saved'>('idle')
  /**
   * Just saved: the times the event had before — a copy of the day read before the save may still come and must
   * not put them back over what was just saved (a few seconds).
   */
  let staleTimes: { s: Ms; e: Ms; until: number } | undefined

  /** The form as it is — what the save compares with the last saved state. */
  function formKey(): string {
    return JSON.stringify([start.value, end.value, followsNow.value, label.value, kind.value, tasks.value.map((t) => t.key), rem.remindMode.value, rem.remindTime.value, date.value, Object.entries(attrs.value).sort()])
  }

  // identity of the thing being edited: re-init the text fields only when it changes
  const identity = computed(() => props.entry.id ?? 'draft')
  watch(
    identity,
    () => {
      label.value = joinTitle(props.entry.label, props.entry.description)
      tasks.value = props.entry.task ? [props.entry.task] : []
      kind.value = props.entry.kind
      attrs.value = { ...props.entry.attrs }
      error.value = ''
      copied.value = ''
      rem.initRemind()
      rem.repeatRule.value = ''
      actions.forgetSeriesScope()
      date.value = props.day
      savedKey = formKey()
      saveState.value = 'idle'
    },
    { immediate: true },
  )
  /**
   * What came from outside (a reload, a call extended by the tracker, the host moving the event) is taken in —
   * but a part the user has changed and not saved yet is kept, and stays to be saved.
   */
  function takeSaved(patch: (k: unknown[]) => void): void {
    const k = JSON.parse(savedKey || '[]') as unknown[]
    patch(k)
    savedKey = JSON.stringify(k)
  }
  // times follow the entry/marker live (marker drags on the timeline)
  watch(
    () => [props.entry.start, props.entry.end, props.entry.followsNow, props.entry.startsNow] as const,
    ([s, e, f, n]) => {
      if (staleTimes && Date.now() < staleTimes.until && s === staleTimes.s && e === staleTimes.e && (start.value !== s || end.value !== e)) return
      if (props.entry.id && savedKey) {
        const k = JSON.parse(savedKey) as unknown[]
        // the times were changed here and not saved yet: they win
        if (k[0] !== start.value || k[1] !== end.value || k[2] !== followsNow.value) return
      }
      start.value = s
      end.value = e
      followsNow.value = !!f
      startsNow.value = !!n
      if (savedKey) takeSaved((k) => ((k[0] = s), (k[1] = e), (k[2] = !!f)))
      else savedKey = formKey()
    },
    { immediate: true },
  )
  // the host moved it to another day (or opened it there): the date follows unless it was changed here
  watch(
    () => props.day,
    (d, old) => {
      if (date.value !== old) return
      date.value = d
      takeSaved((k) => (k[8] = d))
    },
  )

  watch(
    () => formKey(),
    (k) => {
      if (!props.entry.id || props.manual) return
      if (k !== savedKey) saveState.value = 'pending'
      else if (saveState.value === 'pending') saveState.value = 'idle'
    },
  )
  let again = false
  /** Saves what changed (nothing — nothing). */
  async function flush(): Promise<void> {
    if (!props.entry.id || props.manual) return
    // one at a time: a change made during a save is saved right after it
    if (busy.value) return void (again = true)
    const k = formKey()
    if (k === savedKey) return
    saveState.value = 'saving'
    const before = { s: props.entry.start, e: props.entry.end }
    const ok = await actions.save(undefined, true)
    if (ok) {
      savedKey = k
      if (before.s !== start.value || before.e !== end.value) staleTimes = { ...before, until: Date.now() + 4000 }
    }
    saveState.value = ok ? 'saved' : 'idle'
    if (again) {
      again = false
      void flush()
    }
  }

  // leaving the card: a press or the focus elsewhere in the app (its dropdowns float outside it, in <body> — those
  // are still the card), the window losing focus, the card closing
  const appEl = () => document.getElementById('app')
  const isElsewhere = (t: EventTarget | null) => t instanceof Node && !rootEl.value?.contains(t) && !!appEl()?.contains(t)
  const onDocDown = (e: PointerEvent) => isElsewhere(e.target) && void flush()
  const onBlur = () => void flush()
  document.addEventListener('pointerdown', onDocDown, true)
  window.addEventListener('blur', onBlur)
  function onFocusOut(e: FocusEvent): void {
    if (isElsewhere(e.relatedTarget)) void flush()
  }
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocDown, true)
    window.removeEventListener('blur', onBlur)
    void flush()
  })
  function close(): void {
    void flush()
    emit('close')
  }

  return { saveState, flush, onFocusOut, close }
}
