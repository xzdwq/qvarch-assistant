<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { shiftDay } from '@shared/timeline'
import { todayKey } from '../lib/today'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * The one date field of the app: a click opens the month calendar, a second click closes it; the wheel over
 * the field moves the day (over the calendar — the month). Today is lit; any other day gets a button back to
 * today. `clearable` — the date may be empty (a "×" and «Без даты»).
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    clearable?: boolean
    placeholder?: string
    /** 'long' — «Пт, 16 октября»; 'short' — «16 окт»; 'num' — «16.10.2026». */
    format?: 'long' | 'short' | 'num'
    /** No wheel over the field (it sits in a scrolling list). */
    noWheel?: boolean
    /** Red when the date has passed (a due date). */
    late?: boolean
    title?: string
    /** Day, month and year as separate parts: the wheel over each changes that part (the year is always shown). */
    parts?: boolean
  }>(),
  { format: 'long', placeholder: 'Без даты' },
)
const emit = defineEmits<{ 'update:modelValue': [day: string] }>()

const open = ref(false)
/** The field: the calendar opens under it (a press outside — the field's own click toggles — or Esc closes it). */
const root = ref<HTMLElement>()
const month = ref((props.modelValue || todayKey.value).slice(0, 7))
watch(open, (o) => o && (month.value = (props.modelValue || todayKey.value).slice(0, 7)))

const isToday = computed(() => props.modelValue === todayKey.value)
const at = (d: string) => new Date(`${d}T12:00:00`)
type DateFormat = NonNullable<typeof props.format>
/** How a day (YYYY-MM-DD) is written in each format. */
const FORMATTERS: Record<DateFormat, (d: string) => string> = {
  num: (d) => at(d).toLocaleDateString('ru-RU'),
  short: (d) => at(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', ''),
  long: (d) => {
    const s = at(d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', ...(d.slice(0, 4) !== todayKey.value.slice(0, 4) ? { year: 'numeric' } : {}) })
    return s.charAt(0).toUpperCase() + s.slice(1)
  },
}
const text = computed(() => (props.modelValue ? FORMATTERS[props.format](props.modelValue) : props.placeholder))

/** The parts: «Ср, » + «21» + «октября» + «2026» — each its own wheel. */
const segs = computed(() => {
  const d = at(props.modelValue || todayKey.value)
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' })
  const dm = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).split(' ')
  return { wd: wd.charAt(0).toUpperCase() + wd.slice(1), d: dm[0], m: dm.slice(1).join(' '), y: String(d.getFullYear()) }
})
/** The same day N months / years away (the 31st becomes the month's last day). */
function shiftPart(day: string, part: 'm' | 'y', n: number): string {
  const [y, m, dd] = day.split('-').map(Number)
  const ny = part === 'y' ? y + n : y + Math.floor((m - 1 + n) / 12)
  const nm = part === 'y' ? m : ((((m - 1 + n) % 12) + 12) % 12) + 1
  const last = new Date(ny, nm, 0).getDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`
}
function set(d: string): void {
  if (d !== props.modelValue) emit('update:modelValue', d)
}
function pick(d: string): void {
  set(d)
  open.value = false
}
/** The wheel over the field: down / right — the next day. */
function onWheel(e: WheelEvent): void {
  if (props.noWheel) return
  e.preventDefault()
  // up — the next day, down — the previous one (like the times)
  const dir = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) < 0 ? 1 : -1
  const cur = props.modelValue || todayKey.value
  const part = props.parts ? (e.target as HTMLElement).closest<HTMLElement>('[data-p]')?.dataset.p : undefined
  set(part === 'm' || part === 'y' ? shiftPart(cur, part, dir) : shiftDay(cur, dir))
}

// ---------- the calendar ----------
const iso = (d: Date) => d.toLocaleDateString('sv-SE')
const monthTitle = computed(() => {
  const s = at(`${month.value}-01`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')
  return s[0].toUpperCase() + s.slice(1)
})
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** Six weeks from the Monday before the 1st. */
const cells = computed(() => {
  const first = at(`${month.value}-01`)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const day = iso(d)
    return { day, n: d.getDate(), out: day.slice(0, 7) !== month.value, wk: d.getDay() === 0 || d.getDay() === 6 }
  })
})
function shiftMonth(dir: number): void {
  const d = at(`${month.value}-01`)
  d.setMonth(d.getMonth() + dir)
  month.value = iso(d).slice(0, 7)
}
function onCalWheel(e: WheelEvent): void {
  e.preventDefault()
  shiftMonth(e.deltaY > 0 ? 1 : -1)
}
</script>

<template>
  <span ref="root" class="dp tw:group/dp tw:[-webkit-app-region:no-drag] tw:inline-flex tw:items-center tw:flex-none tw:h-28 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:whitespace-nowrap tw:[&.today]:border-accent-line" :class="{ today: isToday, empty: !modelValue, late }" @wheel="onWheel">
    <button class="dpb tw:inline-flex tw:items-center tw:gap-6 tw:h-full tw:py-0 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text tw:text-[12.5px] tw:cursor-default tw:hover:bg-hover tw:[&.on]:not-hover:bg-accent-soft" :class="{ on: open }" :title="title ?? (parts ? 'Выбрать дату · колесо над днём, месяцем или годом меняет его' : 'Выбрать дату · колесо — день')" @click="open = !open">
      <Icon class="tw:text-muted tw:group-[.today]/dp:not-group-[.late]/dp:text-accent-fg tw:group-[.late]/dp:text-down-fg" name="calendar" :size="13" /><span v-if="parts && modelValue" class="parts tw:font-data tw:text-[12px] tw:group-[.today]/dp:not-group-[.empty]/dp:not-group-[.late]/dp:text-accent-fg tw:group-[.empty]/dp:not-group-[.late]/dp:text-muted tw:group-[.late]/dp:text-down-fg"
        ><i class="tw:not-italic" data-p="d">{{ segs.wd }},&nbsp;</i><i data-p="d" class="seg tw:not-italic tw:py-1 tw:px-2 tw:rounded-[3px] tw:hover:bg-accent-soft tw:hover:text-accent-fg">{{ segs.d }}</i>&nbsp;<i data-p="m" class="seg tw:not-italic tw:py-1 tw:px-2 tw:rounded-[3px] tw:hover:bg-accent-soft tw:hover:text-accent-fg">{{ segs.m }}</i>&nbsp;<i data-p="y" class="seg tw:not-italic tw:py-1 tw:px-2 tw:rounded-[3px] tw:hover:bg-accent-soft tw:hover:text-accent-fg">{{ segs.y }}</i></span
      ><span class="tw:font-data tw:text-[12px] tw:group-[.today]/dp:not-group-[.empty]/dp:not-group-[.late]/dp:text-accent-fg tw:group-[.empty]/dp:not-group-[.late]/dp:text-muted tw:group-[.late]/dp:text-down-fg" v-else>{{ text }}</span>
    </button>
    <button v-if="modelValue && !isToday" class="dpi tw:inline-flex tw:items-center tw:gap-6 tw:h-full tw:border-0 tw:rounded-none tw:bg-transparent tw:text-[12.5px] tw:cursor-default tw:hover:bg-hover tw:w-26 tw:justify-center tw:p-0! tw:[&&]:border-l! tw:[&&]:border-l-border! tw:text-muted! tw:hover:text-accent-fg!" title="Сегодня" @click="set(todayKey)"><Icon name="calToday" :size="13" /></button>
    <button v-if="clearable && modelValue" class="dpi tw:inline-flex tw:items-center tw:gap-6 tw:h-full tw:border-0 tw:rounded-none tw:bg-transparent tw:text-[12.5px] tw:cursor-default tw:hover:bg-hover tw:w-26 tw:justify-center tw:p-0! tw:[&&]:border-l! tw:[&&]:border-l-border! tw:text-muted! tw:hover:text-accent-fg!" title="Убрать дату" @click="set('')"><Icon name="x" :size="12" /></button>
  </span>
  <Popover v-model:open="open" :anchor="root" :width="252" align-left :chrome="0" max-height="none" class="dp-pop tw:p-8 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:select-none" @wheel="onCalWheel">
      <div class="dp-head tw:flex tw:items-center tw:justify-between tw:mb-6">
        <button class="tw:inline-flex tw:items-center tw:py-4 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[12px] tw:cursor-default tw:hover:bg-hover tw:hover:text-text" title="Предыдущий месяц" @click="shiftMonth(-1)"><Icon name="chevronLeft" :size="13" /></button>
        <b class="tw:text-[12.5px] tw:font-semibold">{{ monthTitle }}</b>
        <button class="tw:inline-flex tw:items-center tw:py-4 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[12px] tw:cursor-default tw:hover:bg-hover tw:hover:text-text" title="Следующий месяц" @click="shiftMonth(1)"><Icon name="chevronRight" :size="13" /></button>
      </div>
      <div class="dp-grid tw:grid tw:grid-cols-[repeat(7,32px)] tw:gap-2">
        <span v-for="w in WEEK" :key="w" class="dp-w tw:h-22 tw:leading-[22px] tw:text-center tw:text-dim tw:font-data tw:text-[10px] tw:uppercase">{{ w }}</span>
        <button
          v-for="c in cells"
          :key="c.day"
          class="dp-d tw:h-28 tw:p-0 tw:border tw:border-transparent tw:rounded-r2 tw:bg-transparent tw:text-text tw:font-data tw:text-[12px] tw:cursor-default tw:hover:not-[&.sel]:bg-hover tw:[&.wk]:not-[&.now]:not-[&.sel]:text-down-fg tw:[&.out]:opacity-35 tw:[&.now]:not-[&.sel]:border-accent tw:[&.now]:not-[&.sel]:text-accent-fg tw:[&.sel]:bg-accent tw:[&.sel]:border-accent tw:[&.sel]:text-on-accent tw:[&.sel]:font-bold tw:hover:enabled:not-[&.now]:not-[&.sel]:border-border-3"
          :class="{ out: c.out, wk: c.wk, now: c.day === todayKey, sel: c.day === modelValue }"
          @click="pick(c.day)"
        >{{ c.n }}</button>
      </div>
      <div class="dp-foot tw:flex tw:justify-between tw:mt-6 tw:pt-6 tw:border-t tw:border-t-border">
        <button class="tw:inline-flex tw:items-center tw:py-4 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[12px] tw:cursor-default tw:hover:bg-hover tw:hover:text-text" @click="pick(todayKey)">Сегодня</button>
        <button class="tw:inline-flex tw:items-center tw:py-4 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[12px] tw:cursor-default tw:hover:bg-hover tw:hover:text-text" v-if="clearable" @click="pick('')">Без даты</button>
      </div>
  </Popover>
</template>
