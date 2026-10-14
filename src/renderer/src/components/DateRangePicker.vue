<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'

/**
 * A period on a calendar: the first click — the start, the second — the end (either order); the days in
 * between are shaded, "Дней выбрано: N", Отмена / Применить. Opens over everything under its anchor.
 */
const props = defineProps<{ from: string; to: string; anchor: HTMLElement | undefined; max?: number }>()
const emit = defineEmits<{ apply: [from: string, to: string]; close: [] }>()

const iso = (d: Date) => d.toLocaleDateString('sv-SE')
const today = iso(new Date())
const a = ref<string>(props.from)
const b = ref<string | undefined>(props.to)
const hover = ref<string>()
const month = ref(props.from.slice(0, 7))

const range = computed<[string, string] | undefined>(() => {
  const end = b.value ?? hover.value
  if (!end) return undefined
  return a.value <= end ? [a.value, end] : [end, a.value]
})
const count = computed(() => {
  const r = range.value
  if (!r) return 1
  return Math.round((new Date(`${r[1]}T12:00:00`).getTime() - new Date(`${r[0]}T12:00:00`).getTime()) / 86_400_000) + 1
})
const tooLong = computed(() => !!props.max && count.value > props.max)

const title = computed(() => {
  const s = new Date(`${month.value}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')
  return s[0].toUpperCase() + s.slice(1)
})
/** Six weeks from the Monday before the 1st. */
const cells = computed(() => {
  const first = new Date(`${month.value}-01T12:00:00`)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return { day: iso(d), n: d.getDate(), out: iso(d).slice(0, 7) !== month.value }
  })
})
function shiftMonth(dir: 1 | -1): void {
  const d = new Date(`${month.value}-01T12:00:00`)
  d.setMonth(d.getMonth() + dir)
  month.value = iso(d).slice(0, 7)
}
function pick(day: string): void {
  if (b.value !== undefined) {
    a.value = day
    b.value = undefined
  } else b.value = day
}
const inRange = (d: string) => !!range.value && d >= range.value[0] && d <= range.value[1]
const isEdge = (d: string) => !!range.value && (d === range.value[0] || d === range.value[1])
function apply(): void {
  const r = range.value ?? [a.value, a.value]
  if (!tooLong.value) emit('apply', r[0], r[1])
}

// placed under the anchor, inside the window
const el = ref<HTMLElement>()
const pos = ref({ left: 0, top: 0 })
function place(): void {
  const r = props.anchor?.getBoundingClientRect()
  const w = el.value?.offsetWidth ?? 300
  const h = el.value?.offsetHeight ?? 360
  if (!r) return
  let top = r.bottom + 6
  if (top + h > window.innerHeight - 6) top = Math.max(6, r.top - h - 6)
  pos.value = { left: Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6)), top }
}
function onDown(e: MouseEvent): void {
  if (!el.value?.contains(e.target as Node) && !props.anchor?.contains(e.target as Node)) emit('close')
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'Enter') apply()
}
onMounted(() => {
  void nextTick(place)
  window.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="drp" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @mouseleave="hover = undefined">
      <div class="mh">
        <button class="nb" @click="shiftMonth(-1)"><Icon name="chevronLeft" :size="16" /></button>
        <b>{{ title }}</b>
        <button class="nb" @click="shiftMonth(1)"><Icon name="chevronRight" :size="16" /></button>
      </div>
      <div class="grid">
        <span v-for="w in WD" :key="w" class="wd">{{ w }}</span>
        <button
          v-for="c in cells"
          :key="c.day"
          class="dd"
          :class="{ out: c.out, in: inRange(c.day), edge: isEdge(c.day), today: c.day === today }"
          @click="pick(c.day)"
          @mouseenter="b === undefined && (hover = c.day)"
        >
          <span>{{ c.n }}</span>
        </button>
      </div>
      <div class="ft">
        <span :class="{ warn: tooLong }">Дней выбрано: {{ count }}<template v-if="tooLong"> (до {{ max }})</template></span>
      </div>
      <div class="acts">
        <button class="bt" @click="emit('close')">Отмена</button>
        <button class="bt pri" :disabled="tooLong" @click="apply">Применить</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drp {
  position: fixed;
  z-index: 5000;
  width: 296px;
  padding: 12px 14px 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1a1e2b;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6);
  color: var(--text);
  user-select: none;
}
.mh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
}
.nb {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #9aa3b8;
}
.nb:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  row-gap: 3px;
}
.wd {
  padding: 4px 0 6px;
  color: #7d8599;
  font-size: 11px;
  text-align: center;
}
.dd {
  height: 34px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #d6dae6;
  font-size: 13px;
}
.dd span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
}
.dd:hover span {
  background: rgba(255, 255, 255, 0.08);
}
.dd.out {
  color: #5a6175;
}
.dd.today {
  color: #c4b5fd;
  font-weight: 600;
}
/* the period: a band across the days, the ends filled */
.dd.in {
  background: rgba(139, 124, 255, 0.16);
}
.dd.in:nth-child(7n + 1) {
  border-radius: 10px 0 0 10px;
}
.dd.in:nth-child(7n) {
  border-radius: 0 10px 10px 0;
}
.dd.edge span {
  background: #8b7cff;
  color: #fff;
  font-weight: 600;
}
.ft {
  margin: 10px 2px 10px;
  color: #c3c8d6;
  font-size: 12.5px;
}
.ft .warn {
  color: #fca5a5;
}
.acts {
  display: flex;
  gap: 8px;
}
.bt {
  flex: 1;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #d6dae6;
  font-size: 13px;
}
.bt:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
.bt.pri {
  background: #8b7cff;
  color: #fff;
  font-weight: 600;
}
.bt.pri:hover:not(:disabled) {
  filter: brightness(1.1);
}
.bt:disabled {
  opacity: 0.45;
}
</style>
