<script setup lang="ts">
import { usePopover, type Placement } from '../lib/usePopover'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

/** Centred under its anchor (over it when there is no room under), inside the window. */
const centredUnder: Placement = ({ rect: r }, panel) => {
  const w = panel?.offsetWidth ?? 300
  const h = panel?.offsetHeight ?? 360
  let top = r.bottom + 6
  if (top + h > window.innerHeight - 6) top = Math.max(6, r.top - h - 6)
  return { style: { left: `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6))}px`, top: `${top}px` } }
}
const open = computed({ get: () => true, set: (on) => void (on || emit('close')) })
const { panelRef, style } = usePopover(() => props.anchor, { place: centredUnder }, open)
// Enter — the period taken
const onKey = (e: KeyboardEvent) => e.key === 'Enter' && apply()
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
</script>

<template>
  <Teleport to="body">
    <div :ref="panelRef" class="drp tw:fixed tw:z-5000 tw:w-296 tw:pt-12 tw:pr-14 tw:pb-14 tw:pl-14 tw:rounded-r3 tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-dialog)] tw:text-text tw:select-none" :style="style" @mouseleave="hover = undefined" @wheel.prevent="shiftMonth($event.deltaY > 0 ? 1 : -1)">
      <div class="mh tw:flex tw:items-center tw:justify-between tw:mb-8 tw:text-[14px]">
        <button class="nb tw:inline-flex tw:p-4 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" @click="shiftMonth(-1)"><Icon name="chevronLeft" :size="16" /></button>
        <b>{{ title }}</b>
        <button class="nb tw:inline-flex tw:p-4 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" @click="shiftMonth(1)"><Icon name="chevronRight" :size="16" /></button>
      </div>
      <div class="days tw:grid tw:grid-cols-[repeat(7,1fr)] tw:gap-y-3">
        <span v-for="w in WD" :key="w" class="wd tw:pt-4 tw:pr-0 tw:pb-6 tw:pl-0 tw:text-dim tw:text-[11px] tw:text-center">{{ w }}</span>
        <button
          v-for="c in cells"
          :key="c.day"
          class="dd tw:group/dd tw:h-34 tw:m-0 tw:p-0 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text tw:text-[13px] tw:[&.out]:not-[&.today]:text-dim tw:[&.today]:text-accent-fg tw:[&.today]:font-semibold tw:[&.in]:bg-accent/16 tw:[&.in]:nth-[7n+1]:rounded-[4px_0_0_4px] tw:[&.in]:nth-[7n]:not-nth-[7n+1]:rounded-[0_4px_4px_0] tw:hover:enabled:not-[&.in]:bg-hover tw:hover:enabled:border-border-3"
          :class="{ out: c.out, in: inRange(c.day), edge: isEdge(c.day), today: c.day === today }"
          @click="pick(c.day)"
          @mouseenter="b === undefined && (hover = c.day)"
        >
          <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-32 tw:h-32 tw:rounded-[4px] tw:group-hover/dd:not-group-[.edge]/dd:bg-white/8 tw:group-[.edge]/dd:bg-accent tw:group-[.edge]/dd:text-on-accent tw:group-[.edge]/dd:font-semibold">{{ c.n }}</span>
        </button>
      </div>
      <div class="ft tw:my-10 tw:mx-2 tw:text-text-2 tw:text-[12.5px]">
        <span class="tw:[&.warn]:text-down-fg" :class="{ warn: tooLong }">Дней выбрано: {{ count }}<template v-if="tooLong"> (до {{ max }})</template></span>
      </div>
      <div class="acts tw:flex tw:gap-8">
        <button class="bt tw:flex-1 tw:h-34 tw:border-0 tw:rounded-[4px] tw:bg-white/8 tw:text-text tw:text-[13px] tw:hover:enabled:bg-white/12 tw:disabled:opacity-45 tw:hover:enabled:border-border-3" @click="emit('close')">Отмена</button>
        <button class="bt pri tw:flex-1 tw:h-34 tw:border-0 tw:rounded-[4px] tw:text-[13px] tw:hover:enabled:bg-white/12 tw:bg-accent tw:text-on-accent tw:font-semibold tw:hover:enabled:filter-[brightness(1.1)] tw:disabled:opacity-45 tw:hover:enabled:border-border-3" :disabled="tooLong" @click="apply">Применить</button>
      </div>
    </div>
  </Teleport>
</template>
