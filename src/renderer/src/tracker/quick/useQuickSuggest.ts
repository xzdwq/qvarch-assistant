import { computed, nextTick, ref } from 'vue'
import { pickableTasks, type TaskRef } from '@shared/jira'
import type { KindDef } from '@shared/types'
import { useJira } from '../../lib/jira'
import { useLocalTasks } from '../../lib/tasks'

/** What the quick line suggests: «@» — a task, «#» — a kind. */
export type SuggestTrigger = '@' | '#'
export interface SuggestItem {
  id: string
  title: string
  sub?: string
  color?: string
  icon: string
}
interface Suggest {
  type: SuggestTrigger
  /** Where the «@…» / «#…» starts in the text. */
  from: number
  items: SuggestItem[]
}

/** The tasks list stops at this many. */
const TASKS_SHOWN = 8

/**
 * The «@» task / «#» kind suggestions of a quick line (QuickAdd, QuickField): the list under the caret, the keys
 * that walk and pick it, the picked one leaving its «@…» / «#…» out of the text. The field owns the keys.
 */
export function useQuickSuggest(o: {
  text: () => string
  setText: (text: string) => void
  field: () => HTMLInputElement | HTMLTextAreaElement | undefined
  /** The kinds offered after «#». */
  kinds: () => KindDef[]
  /** Blanks the pick leaves behind that collapse into one (a textarea keeps its line breaks). */
  blanks: RegExp
  onPick: (type: SuggestTrigger, item: SuggestItem) => void
  /** Enter / Tab picking stops there too (the field sits inside a form that listens). */
  stopOnPick?: boolean
}) {
  const jira = useJira()
  const own = useLocalTasks()
  /** Every task that can be named: own (open) and mine / starred in Jira. */
  const allTasks = computed<Array<TaskRef & { own: boolean }>>(() => [
    ...own.value.filter((t) => t.key && t.status !== 'done').map((t) => ({ key: t.key!, summary: t.title, own: true })),
    ...pickableTasks(jira.value).map((i) => ({ key: i.key, summary: i.summary, own: false })),
  ])
  const summaryOf = (key: string) => allTasks.value.find((t) => t.key === key)?.summary ?? jira.value.issues.find((i) => i.key === key)?.summary ?? ''

  /** The items of each trigger for the typed query `s`. */
  const ITEMS: Record<SuggestTrigger, (s: string) => SuggestItem[]> = {
    '#': (s) => o.kinds().filter((k) => k.label.toLowerCase().includes(s)).map((k) => ({ id: k.id, title: k.label, color: k.color, icon: k.icon })),
    '@': (s) =>
      allTasks.value
        .filter((t) => t.key.toLowerCase().includes(s) || t.summary.toLowerCase().includes(s))
        .slice(0, TASKS_SHOWN)
        .map((t) => ({ id: t.key, title: t.key, sub: t.summary, icon: t.own ? 'checkSquare' : 'jira' })),
  }

  const sug = ref<Suggest>()
  const active = ref(0)
  /** The list under the field (the field owns the keys, Esc too); closed — the «@» / «#» forgotten. */
  const sugOpen = computed({ get: () => !!sug.value?.items.length, set: (v) => void (v || (sug.value = undefined)) })

  /** Looks at the word under the caret: «@…» / «#…» opens (or narrows) the list, anything else closes it. */
  function updateSug(): void {
    const el = o.field()
    if (!el) return
    const text = o.text()
    const before = text.slice(0, el.selectionStart ?? text.length)
    const m = before.match(/(^|\s)([@#])([^\s]*)$/)
    if (!m) return void (sug.value = undefined)
    const type = m[2] as SuggestTrigger
    sug.value = { type, from: before.length - m[2].length - m[3].length, items: ITEMS[type](m[3].toLowerCase()) }
    active.value = 0
  }

  /** A picked suggestion is handed over — its «@…» / «#…» leaves the text, the caret stays where it began. */
  function pickSug(i: number): void {
    const s = sug.value
    const it = s?.items[i]
    const el = o.field()
    if (!s || !it || !el) return
    const text = o.text()
    const caret = el.selectionStart ?? text.length
    o.setText(`${text.slice(0, s.from)}${text.slice(caret)}`.replace(o.blanks, ' '))
    o.onPick(s.type, it)
    sug.value = undefined
    void nextTick(() => {
      const f = o.field()
      f?.focus()
      f?.setSelectionRange(s.from, s.from)
    })
  }

  /** The list's keys while it is open: ↓ / ↑ walk, Enter / Tab pick, Esc closes; true — the key was the list's. */
  const LIST_KEYS: Partial<Record<string, (e: KeyboardEvent, n: number) => void>> = {
    ArrowDown: (e, n) => {
      e.preventDefault()
      active.value = (active.value + 1) % n
    },
    ArrowUp: (e, n) => {
      e.preventDefault()
      active.value = (active.value + n - 1) % n
    },
    Enter: (e) => pickByKey(e),
    Tab: (e) => pickByKey(e),
    Escape: (e) => {
      e.stopPropagation()
      sug.value = undefined
    },
  }
  function pickByKey(e: KeyboardEvent): void {
    e.preventDefault()
    if (o.stopOnPick) e.stopPropagation()
    pickSug(active.value)
  }
  function onSugKey(e: KeyboardEvent): boolean {
    const act = sugOpen.value ? LIST_KEYS[e.key] : undefined
    act?.(e, sug.value!.items.length)
    return !!act
  }

  return { allTasks, summaryOf, sug, active, sugOpen, updateSug, pickSug, onSugKey }
}
