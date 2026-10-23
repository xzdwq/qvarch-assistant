<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCron, type CronFormat } from '@vue-js-cron/core'
import { openWhile } from '../../lib/usePopover'
import Icon from '../Icon.vue'
import Popover from '../Popover.vue'

/**
 * The cron expression as a sentence of choices («Каждую неделю по пн-сб в 12 : 00») — @vue-js-cron/core does
 * the cron side (its periods, fields and Russian words); this is only its look. Both ways: the sentence follows
 * the expression typed, a choice changes the expression.
 */
const props = defineProps<{ modelValue: string; format: CronFormat }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

// the library's Russian, set right (its period words are «Каждый Неделя»)
const customLocale = {
  '*': { prefix: '' },
  minute: { prefix: '', text: 'Каждую минуту' },
  hour: { prefix: '', text: 'Каждый час' },
  day: { prefix: '', text: 'Каждый день' },
  week: { prefix: '', text: 'Каждую неделю' },
  month: { prefix: '', text: 'Каждый месяц' },
  year: { prefix: '', text: 'Каждый год' },
  'q-second': { prefix: '', text: 'Каждую секунду' },
  'q-minute': { prefix: '', text: 'Каждую минуту' },
  'q-hour': { prefix: '', text: 'Каждый час' },
}
/**
 * The narrowest period that shows every field the expression sets («0 12 * * 1-6» — a week, not a year: the
 * library would take the widest one that fits).
 */
/** The library's fields of a crontab expression, in order (the other dialects put seconds first). */
const FIELD_IDS = ['minute', 'hour', 'day', 'month', 'dayOfWeek']
/** Each period (narrowest first) and the fields it shows. */
const PERIOD_FIELDS: Record<string, readonly string[]> = {
  minute: [],
  hour: ['minute'],
  day: ['hour', 'minute'],
  week: ['dayOfWeek', 'hour', 'minute'],
  month: ['day', 'dayOfWeek', 'hour', 'minute'],
  year: ['month', 'day', 'dayOfWeek', 'hour', 'minute'],
}
/** The periods the library names apart in the dialects with seconds («q-minute»). */
const SECONDS_PERIODS = new Set(['minute', 'hour'])
function bestPeriod(expr: string): string | undefined {
  const parts = expr.trim().split(/\s+/)
  const withSeconds = props.format !== 'crontab'
  const ids = withSeconds ? ['second', ...FIELD_IDS] : FIELD_IDS
  if (parts.length !== ids.length) return undefined
  const set = ids.filter((id, i) => id !== 'second' && parts[i] !== '*' && parts[i] !== '?')
  const hit = Object.keys(PERIOD_FIELDS).find((p) => set.every((f) => PERIOD_FIELDS[p].includes(f)))
  return hit && withSeconds && SECONDS_PERIODS.has(hit) ? `q-${hit}` : hit
}
const c = useCron({ initialValue: props.modelValue || undefined, initialPeriod: bestPeriod(props.modelValue), format: props.format, locale: 'ru', customLocale: customLocale as never })
let echo = ''
watch(
  () => props.modelValue,
  (v) => {
    if (v && v !== c.cron.value && v.trim().split(/\s+/).length === c.segments.length) {
      echo = v
      const p = bestPeriod(v)
      // typed in from outside: the sentence takes the period that shows it
      if (p && p !== c.period.selected.value.id) c.period.select(p)
      c.cron.value = v
    }
  },
)
watch(c.cron, (v) => {
  if (v === echo) return
  echo = ''
  emit('update:modelValue', v)
})
const fits = computed(() => !props.modelValue.trim() || props.modelValue.trim().split(/\s+/).length === c.segments.length)

// ---------- the pickers ----------
/** The picker open (its segment's id, or the period) and the chip it opened from. */
const openId = ref<string>()
const anchor = ref<HTMLElement>()
const isOpen = openWhile(openId)
const POP_WIDTH: Record<string, number> = { period: 220, minute: 340, second: 340 }
const popWidth = () => POP_WIDTH[openId.value ?? ''] ?? 300
function toggle(id: string, e: MouseEvent): void {
  if (openId.value === id) return void (openId.value = undefined)
  anchor.value = e.currentTarget as HTMLElement
  openId.value = id
}
const seg = computed(() => c.segments.find((s) => s.id === openId.value))
const COLS: Record<string, number> = { second: 6, minute: 6, hour: 6, day: 7, month: 3, dayOfWeek: 1 }
function pick(v: number): void {
  const s = seg.value
  if (!s) return
  const cur = new Set(s.selected.value)
  if (cur.has(v)) cur.delete(v)
  else cur.add(v)
  s.select([...cur])
}
const NAMES: Record<string, string> = { second: 'Секунды', minute: 'Минуты', hour: 'Часы', day: 'Дни месяца', month: 'Месяцы', dayOfWeek: 'Дни недели' }
</script>

<template>
  <div class="cb tw:flex tw:items-center tw:flex-wrap tw:gap-6 tw:text-[13.5px]">
    <template v-if="fits">
      <button class="cbchip per tw:inline-flex tw:items-center tw:gap-5 tw:h-30 tw:py-0 tw:px-10 tw:border tw:border-accent/45 tw:rounded-r2 tw:bg-accent/8 tw:text-text-hi tw:text-[13px] tw:[&.on]:not-hover:bg-accent/20 tw:hover:bg-accent/20 tw:font-semibold tw:hover:enabled:border-border-3" :class="{ on: openId === 'period' }" @click="toggle('period', $event)">{{ c.period.selected.value.text }}<Icon name="chevronDown" :size="11" /></button>
      <template v-for="s in c.selected.value" :key="s.id">
        <span v-if="s.prefix.value" class="w tw:text-text-2">{{ s.prefix.value }}</span>
        <button class="cbchip tw:inline-flex tw:items-center tw:gap-5 tw:h-30 tw:py-0 tw:px-10 tw:border tw:border-accent/45 tw:rounded-r2 tw:bg-accent/8 tw:text-text-hi tw:text-[13px] tw:[&.any]:border-dashed tw:[&.any]:text-text-2 tw:[&.on]:not-hover:bg-accent/20 tw:hover:bg-accent/20 tw:hover:enabled:border-border-3" :class="{ on: openId === s.id, any: !s.selected.value.length }" :title="NAMES[s.id]" @click="toggle(s.id, $event)">{{ s.text.value || '—' }}<Icon name="chevronDown" :size="11" /></button>
        <span v-if="s.suffix.value" class="w tw:text-text-2">{{ s.suffix.value }}</span>
      </template>
    </template>
    <p v-else class="muted tw:m-0 tw:text-muted tw:text-[12.5px]">Конструктор не разбирает это выражение (другое число полей — например, год в Quartz). Описание и запуски ниже — по самому выражению.</p>
    <Popover v-model:open="isOpen" :anchor="anchor" :width="popWidth" align-left :chrome="40" max-height="none" class="cbpop tw:flex tw:flex-col tw:gap-8 tw:max-h-420 tw:p-10 tw:overflow-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
      <template v-if="openId === 'period'">
        <button v-for="p in c.period.items" :key="p.id" class="pi tw:h-30 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-left tw:hover:not-[&.on]:bg-hover tw:[&.on]:text-accent-fg tw:[&.on]:bg-accent/12 tw:hover:enabled:border-border-3" :class="{ on: c.period.selected.value.id === p.id }" @click="(c.period.select(p.id), (openId = undefined))">{{ p.text }}</button>
      </template>
      <template v-else-if="seg">
        <div class="ph tw:flex tw:items-center tw:gap-8 tw:text-[12.5px]">
          <b class="tw:text-text-hi">{{ NAMES[seg.id] }}</b>
          <span class="muted tw:m-0 tw:text-muted tw:text-[12.5px]">можно несколько</span>
          <span class="grow tw:flex-1"></span>
          <button class="lnk tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:border-accent/60 tw:[&.on]:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: !seg.selected.value.length }" @click="seg.select([])">Любые</button>
        </div>
        <div class="cells tw:grid tw:gap-3" :style="{ gridTemplateColumns: `repeat(${COLS[seg.id] ?? 6}, minmax(0, 1fr))` }">
          <button v-for="it in seg.items" :key="it.value" class="gi tw:h-28 tw:py-0 tw:px-4 tw:border tw:border-transparent tw:rounded-r2 tw:bg-panel tw:text-text-2 tw:font-data tw:text-[12px] tw:[&.wide]:font-ui tw:[&.wide]:text-left tw:[&.wide]:py-0 tw:[&.wide]:px-10 tw:hover:not-[&.on]:text-text tw:hover:not-[&.on]:border-border-2 tw:[&.on]:bg-accent/25 tw:[&.on]:text-accent-fg tw:[&.on]:border-accent/60 tw:hover:enabled:not-[&.on]:bg-hover" :class="{ on: seg.selected.value.includes(it.value), wide: seg.id === 'dayOfWeek' }" @click="pick(it.value)">{{ seg.id === 'dayOfWeek' || seg.id === 'month' ? it.alt : it.text }}</button>
        </div>
      </template>
    </Popover>
  </div>
</template>
