import { computed, inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue'
import { remoteError } from '../../../../shared/remoteError'
import type { TaskRef } from '@shared/jira'
import type { PublicSettings } from '@shared/types'
import type QuickAdd from '../../components/QuickAdd.vue'
import type Timeline from '../../components/Timeline.vue'
import { refreshMentions } from '../../lib/mentions'
import { todayKey } from '../../lib/today'
import { useNow } from '../../lib/useDay'
import { useRange, type RangeDay } from '../../lib/useRange'
import { rememberedChoice, useBoardPeriod } from './useBoardPeriod'

export type QuickAddInstance = InstanceType<typeof QuickAdd>
export type TimelineInstance = InstanceType<typeof Timeline>

/** What WorkBoard gets from outside: the settings, and a day / block to show (opened from elsewhere). */
export interface WorkBoardProps {
  settings: PublicSettings
  focus?: { day: string; entryId?: string; n: number }
}

/**
 * The work board's shared state: the chosen day and period with their loaded days, the remembered view
 * choices, the block opened / hovered, the quick line and the timeline. Created once by WorkBoard, read by
 * its parts through `useWorkBoard()`.
 */
export function createWorkBoard(props: WorkBoardProps, quick: Ref<QuickAddInstance | undefined>) {
  const period = useBoardPeriod()
  const { day, per } = period
  const { days, reload } = useRange(period.weekStart, period.weekEnd)
  const now = useNow(5_000)
  const isToday = computed(() => day.value === todayKey.value)
  const empty = (d: string): RangeDay => ({ day: d, entries: [], notes: [], plan: [], dayTasks: [] })
  const cur = computed(() => days.value.find((d) => d.day === day.value) ?? empty(day.value))
  const err = ref('')
  const fail = (e: unknown) => (err.value = remoteError(e))
  /** The block just added / opened from elsewhere — lit for a moment. */
  const flash = ref<string>()
  const flashFor = (id: string, ms: number) => {
    flash.value = id
    setTimeout(() => flash.value === id && (flash.value = undefined), ms)
  }
  // the notes the events are mentioned in
  refreshMentions()

  // ---------- the view, remembered ----------
  /** The top: the week, or the chosen day's timeline. */
  const top = rememberedChoice<'week' | 'timeline'>('qa.work.top', ['timeline', 'week'], 'timeline')
  /** The day's list, or Заполнение (the period's sheet). */
  const feedTab = rememberedChoice<'list' | 'sheet'>('qa.work.feedTab', ['list', 'sheet'], 'list')
  /** The day's records: newest first (the default) or oldest first. */
  const feedOrder = rememberedChoice<'desc' | 'asc'>('qa.work.feedOrder', ['desc', 'asc'], 'desc')
  /** Лента: its order follows the records' (on) or is its own — the earliest first (off, the default). */
  const streamLinked = rememberedChoice<'on' | 'off'>('qa.work.streamLinked', ['off', 'on'], 'off')
  /** Лента: the record under the pointer on the left is lit and scrolled to in it (off by default). */
  const streamFollow = rememberedChoice<'on' | 'off'>('qa.work.streamFollow', ['off', 'on'], 'off')

  /** The event edited in the stream on the right, and the one hovered in the list (the stream follows it). */
  const openId = ref<string>()
  const hoverId = ref<string>()

  // a day / a block opened from elsewhere (the island, a report, a reminder): that day, the block picked
  watch(
    () => props.focus?.n,
    () => {
      const f = props.focus
      if (!f) return
      if (per.value.mode === 'range' && (f.day < per.value.from || f.day > per.value.to)) per.value = { mode: 'week' }
      day.value = f.day
      if (f.entryId) {
        openId.value = f.entryId
        feedTab.value = 'list'
        flashFor(f.entryId, 2500)
      }
    },
    { immediate: true },
  )

  /** A task joins the day's task list (once). */
  async function addTaskToDay(d: string, t: TaskRef): Promise<void> {
    const list = d === day.value ? cur.value.dayTasks : ((await window.qa.getDay(d)).dayTasks ?? [])
    if (!list.some((x) => x.key === t.key)) await window.qa.setDayTasks(d, [...list, { key: t.key, summary: t.summary }])
  }

  // ---------- the quick line ----------
  /** N or / anywhere in the section (not while typing) — to the quick line. */
  function onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement
    if (e.ctrlKey || e.altKey || e.metaKey || t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return
    if (e.code === 'KeyN' || e.code === 'Slash') {
      e.preventDefault()
      quick.value?.focus()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

  // ---------- the timeline ----------
  /** Following the time on the timeline (the same switch as the Таймлайн section's — a setting). */
  const tlRef = shallowRef<TimelineInstance>()
  const following = computed(() => !!props.settings.ui.timeline.follow)

  return {
    ...period,
    settings: computed(() => props.settings),
    days,
    reload,
    now,
    isToday,
    cur,
    err,
    fail,
    flash,
    flashFor,
    top,
    feedTab,
    feedOrder,
    streamLinked,
    streamFollow,
    openId,
    hoverId,
    addTaskToDay,
    quick,
    tlRef,
    following,
  }
}

export type WorkBoardState = ReturnType<typeof createWorkBoard>
const WORK_BOARD: InjectionKey<WorkBoardState> = Symbol('workBoard')

/** Creates the board's state and hands it to the parts below. */
export function provideWorkBoard(props: WorkBoardProps, quick: Ref<QuickAddInstance | undefined>): WorkBoardState {
  const s = createWorkBoard(props, quick)
  provide(WORK_BOARD, s)
  return s
}
/** The board's state (inside WorkBoard). */
export function useWorkBoard(): WorkBoardState {
  const s = inject(WORK_BOARD)
  if (!s) throw new Error('useWorkBoard() outside WorkBoard')
  return s
}
