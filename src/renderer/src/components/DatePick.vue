<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { shiftDay } from '@shared/timeline'
import { placeFloat, useAnchor } from '../lib/floating'
import { todayKey } from '../lib/today'
import Icon from './Icon.vue'

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
  }>(),
  { format: 'long', placeholder: 'Без даты' },
)
const emit = defineEmits<{ 'update:modelValue': [day: string] }>()

const open = ref(false)
const root = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
const month = ref((props.modelValue || todayKey.value).slice(0, 7))
useAnchor(open, root, () => {
  if (root.value) style.value = placeFloat(root.value, 252, true, 0).style
})
watch(open, (o) => o && (month.value = (props.modelValue || todayKey.value).slice(0, 7)))

const isToday = computed(() => props.modelValue === todayKey.value)
const at = (d: string) => new Date(`${d}T12:00:00`)
const text = computed(() => {
  const d = props.modelValue
  if (!d) return props.placeholder
  if (props.format === 'num') return at(d).toLocaleDateString('ru-RU')
  if (props.format === 'short') return at(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
  const s = at(d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', ...(d.slice(0, 4) !== todayKey.value.slice(0, 4) ? { year: 'numeric' } : {}) })
  return s.charAt(0).toUpperCase() + s.slice(1)
})

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
  set(shiftDay(props.modelValue || todayKey.value, dir))
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

// a press outside (the field too — its own click toggles) closes; Esc closes
const pop = ref<HTMLElement>()
function onDown(e: PointerEvent): void {
  const t = e.target as Node
  if (open.value && !root.value?.contains(t) && !pop.value?.contains(t)) open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (open.value && e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  }
}
onMounted(() => {
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDown, true)
  document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <span ref="root" class="dp" :class="{ today: isToday, empty: !modelValue, late }" @wheel="onWheel">
    <button class="dpb" :class="{ on: open }" :title="title ?? 'Выбрать дату · колесо — день'" @click="open = !open">
      <Icon name="calendar" :size="13" /><span>{{ text }}</span>
    </button>
    <button v-if="modelValue && !isToday" class="dpi" title="Сегодня" @click="set(todayKey)"><Icon name="calToday" :size="13" /></button>
    <button v-if="clearable && modelValue" class="dpi" title="Убрать дату" @click="set('')"><Icon name="x" :size="12" /></button>
  </span>
  <Teleport to="body">
    <div v-if="open" ref="pop" class="dp-pop" :style="style" @wheel="onCalWheel">
      <div class="dp-head">
        <button title="Предыдущий месяц" @click="shiftMonth(-1)"><Icon name="chevronLeft" :size="13" /></button>
        <b>{{ monthTitle }}</b>
        <button title="Следующий месяц" @click="shiftMonth(1)"><Icon name="chevronRight" :size="13" /></button>
      </div>
      <div class="dp-grid">
        <span v-for="w in WEEK" :key="w" class="dp-w">{{ w }}</span>
        <button
          v-for="c in cells"
          :key="c.day"
          class="dp-d"
          :class="{ out: c.out, wk: c.wk, now: c.day === todayKey, sel: c.day === modelValue }"
          @click="pick(c.day)"
        >{{ c.n }}</button>
      </div>
      <div class="dp-foot">
        <button @click="pick(todayKey)">Сегодня</button>
        <button v-if="clearable" @click="pick('')">Без даты</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dp {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  flex: none;
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  white-space: nowrap;
}
.dp button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  cursor: default;
}
.dp button:hover {
  background: var(--hover);
}
.dpb > svg {
  color: var(--muted);
}
.dpb span {
  font-family: var(--font-data);
  font-size: 12px;
}
.dpb.on {
  background: var(--accent-soft);
}
.dp.today {
  border-color: var(--accent-line);
}
.dp.today .dpb > svg,
.dp.today .dpb span {
  color: var(--accent-fg);
}
.dp.empty .dpb span {
  color: var(--muted);
}
.dp.late .dpb span,
.dp.late .dpb > svg {
  color: var(--down-fg);
}
.dpi {
  width: 26px;
  justify-content: center;
  padding: 0 !important;
  border-left: 1px solid var(--border) !important;
  color: var(--muted) !important;
}
.dpi:hover {
  color: var(--accent-fg) !important;
}
.dp-pop {
  padding: 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  user-select: none;
}
.dp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.dp-head b {
  font-size: 12.5px;
  font-weight: 600;
}
.dp-head button,
.dp-foot button {
  display: inline-flex;
  align-items: center;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: default;
}
.dp-head button:hover,
.dp-foot button:hover {
  background: var(--hover);
  color: var(--text);
}
.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 32px);
  gap: 2px;
}
.dp-w {
  height: 22px;
  line-height: 22px;
  text-align: center;
  color: var(--dim);
  font-family: var(--font-data);
  font-size: 10px;
  text-transform: uppercase;
}
.dp-d {
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
  cursor: default;
}
.dp-d:hover {
  background: var(--hover);
}
.dp-d.wk {
  color: var(--down-fg);
}
.dp-d.out {
  opacity: 0.35;
}
.dp-d.now {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.dp-d.sel {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
}
.dp-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
</style>
