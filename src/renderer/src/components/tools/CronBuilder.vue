<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCron, type CronFormat } from '@vue-js-cron/core'
import { placeFloat, useAnchor } from '../../lib/floating'
import Icon from '../Icon.vue'

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
const PERIODS = ['minute', 'hour', 'day', 'week', 'month', 'year']
function bestPeriod(expr: string): string | undefined {
  const parts = expr.trim().split(/\s+/)
  const ids = props.format === 'crontab' ? ['minute', 'hour', 'day', 'month', 'dayOfWeek'] : ['second', 'minute', 'hour', 'day', 'month', 'dayOfWeek']
  if (parts.length !== ids.length) return undefined
  const set = ids.filter((id, i) => id !== 'second' && parts[i] !== '*' && parts[i] !== '?')
  const need = (p: string) => ({ minute: [], hour: ['minute'], day: ['hour', 'minute'], week: ['dayOfWeek', 'hour', 'minute'], month: ['day', 'dayOfWeek', 'hour', 'minute'], year: ['month', 'day', 'dayOfWeek', 'hour', 'minute'] })[p] ?? []
  const q = props.format === 'crontab' ? '' : 'q-'
  const hit = PERIODS.find((p) => set.every((f) => need(p).includes(f)))
  return hit && (hit === 'minute' || hit === 'hour') ? q + hit : hit
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
const openId = ref<string>()
const anchor = ref<HTMLElement>()
const popStyle = ref<Record<string, string>>({})
const isOpen = computed(() => !!openId.value)
useAnchor(isOpen, anchor, () => anchor.value && (popStyle.value = placeFloat(anchor.value, openId.value === 'period' ? 220 : openId.value === 'minute' || openId.value === 'second' ? 340 : 300, true, 40).style))
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
function onDocDown(e: PointerEvent): void {
  const t = e.target as HTMLElement
  if (!t.closest('.cbpop') && !t.closest('.cbchip')) openId.value = undefined
}
watch(isOpen, (on) => (on ? window.addEventListener('pointerdown', onDocDown, true) : window.removeEventListener('pointerdown', onDocDown, true)))
const NAMES: Record<string, string> = { second: 'Секунды', minute: 'Минуты', hour: 'Часы', day: 'Дни месяца', month: 'Месяцы', dayOfWeek: 'Дни недели' }
</script>

<template>
  <div class="cb">
    <template v-if="fits">
      <button class="cbchip per" :class="{ on: openId === 'period' }" @click="toggle('period', $event)">{{ c.period.selected.value.text }}<Icon name="chevronDown" :size="11" /></button>
      <template v-for="s in c.selected.value" :key="s.id">
        <span v-if="s.prefix.value" class="w">{{ s.prefix.value }}</span>
        <button class="cbchip" :class="{ on: openId === s.id, any: !s.selected.value.length }" :title="NAMES[s.id]" @click="toggle(s.id, $event)">{{ s.text.value || '—' }}<Icon name="chevronDown" :size="11" /></button>
        <span v-if="s.suffix.value" class="w">{{ s.suffix.value }}</span>
      </template>
    </template>
    <p v-else class="muted">Конструктор не разбирает это выражение (другое число полей — например, год в Quartz). Описание и запуски ниже — по самому выражению.</p>
    <Teleport to="body">
      <div v-if="openId === 'period'" class="cbpop" :style="popStyle">
        <button v-for="p in c.period.items" :key="p.id" class="pi" :class="{ on: c.period.selected.value.id === p.id }" @click="(c.period.select(p.id), (openId = undefined))">{{ p.text }}</button>
      </div>
      <div v-else-if="seg" class="cbpop" :style="popStyle">
        <div class="ph">
          <b>{{ NAMES[seg.id] }}</b>
          <span class="muted">можно несколько</span>
          <span class="grow"></span>
          <button class="lnk" :class="{ on: !seg.selected.value.length }" @click="seg.select([])">Любые</button>
        </div>
        <div class="grid" :style="{ gridTemplateColumns: `repeat(${COLS[seg.id] ?? 6}, minmax(0, 1fr))` }">
          <button v-for="it in seg.items" :key="it.value" class="gi" :class="{ on: seg.selected.value.includes(it.value), wide: seg.id === 'dayOfWeek' }" @click="pick(it.value)">{{ seg.id === 'dayOfWeek' || seg.id === 'month' ? it.alt : it.text }}</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 6px;
  font-size: 13.5px;
}
.w {
  color: var(--text-2);
}
.cbchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgb(var(--accent-rgb) / 0.45);
  border-radius: var(--r2);
  background: rgb(var(--accent-rgb) / 0.08);
  color: var(--text-hi);
  font-size: 13px;
}
.cbchip.any {
  border-style: dashed;
  color: var(--text-2);
}
.cbchip.on,
.cbchip:hover {
  background: rgb(var(--accent-rgb) / 0.2);
}
.cbchip.per {
  font-weight: 600;
}
.muted {
  margin: 0;
  color: var(--muted);
  font-size: 12.5px;
}
.cbpop {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.cbpop .ph {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.cbpop .ph b {
  color: var(--text-hi);
}
.grow {
  flex: 1;
}
.lnk {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.lnk.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  color: var(--accent-fg);
}
.grid {
  display: grid;
  gap: 3px;
}
.gi {
  height: 28px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: var(--r2);
  background: var(--panel);
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 12px;
}
.gi.wide {
  font-family: var(--font-ui);
  text-align: left;
  padding: 0 10px;
}
.gi:hover {
  color: var(--text);
  border-color: var(--border-2);
}
.gi.on {
  background: rgb(var(--accent-rgb) / 0.25);
  color: var(--accent-fg);
  border-color: rgb(var(--accent-rgb) / 0.6);
}
.pi {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  text-align: left;
}
.pi:hover {
  background: var(--hover);
}
.pi.on {
  color: var(--accent-fg);
  background: rgb(var(--accent-rgb) / 0.12);
}
</style>
