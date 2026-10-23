<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { labelWithoutKey, pickableTasks, plainTask } from '@shared/jira'
import { plannedWithin } from '@shared/plan'
import { formatDuration, formatHM } from '@shared/timeline'
import type { Ms, PlanBlock } from '@shared/types'
import { isKind } from '@shared/tracker/constants'
import Icon from './Icon.vue'
import TimeRange from './TimeRange.vue'
import OffsetField from './OffsetField.vue'
import { useJira } from '../lib/jira'
import { entryIcon, kindColor, kindLabel, kinds } from '../lib/palette'

/**
 * "План дня": kinds and Jira tasks to drag onto the plan lane of the timeline, lunch by the schedule
 * in one click, the planned share of the work day, and the selected plan block's editor
 * ("сделано по плану" turns it into a real block).
 */
const props = defineProps<{ day: string; plan: PlanBlock[]; schedule: { work?: [Ms, Ms]; lunch?: [Ms, Ms] }; selectedId?: string }>()
const emit = defineEmits<{
  changed: []
  select: [id: string | undefined]
  close: []
  /** a palette item released somewhere — the timeline decides if it is over the plan lane */
  drop: [drop: { x: number; y: number; payload: string }]
  dragging: [on: boolean]
}>()

const jira = useJira()
const minutes = ref(60)
const custom = ref('')
const q = ref('')

const planKinds = computed(() => kinds.value.filter((k) => !k.hidden))
const tasks = computed(() => {
  const s = q.value.trim().toLowerCase()
  return pickableTasks(jira.value).filter((i) => !s || i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s))
})
const workMs = computed(() => (props.schedule.work ? props.schedule.work[1] - props.schedule.work[0] - (props.schedule.lunch ? props.schedule.lunch[1] - props.schedule.lunch[0] : 0) : 0))
const plannedWork = computed(() => {
  const w = props.schedule.work
  if (!w) return 0
  const nonLunch = props.plan.filter((p) => !isKind(p.kind, 'lunch'))
  return plannedWithin(nonLunch, w[0], w[1])
})
const hasLunch = computed(() => {
  const l = props.schedule.lunch
  return !!l && props.plan.some((p) => isKind(p.kind, 'lunch') && p.start < l[1] && p.end > l[0])
})

type PlanItem = { kind: string; label: string; task?: { key: string; summary: string }; minutes: number }
/** The item being dragged to the timeline (a ghost follows the cursor). */
const ghost = ref<{ item: PlanItem; x: number; y: number; x0: number; y0: number; moved: boolean }>()
function startDrag(e: PointerEvent, item: PlanItem): void {
  if (e.button !== 0) return
  e.preventDefault()
  ghost.value = { item, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}
function onMove(e: PointerEvent): void {
  const g = ghost.value
  if (!g) return
  g.x = e.clientX
  g.y = e.clientY
  if (!g.moved && Math.hypot(g.x - g.x0, g.y - g.y0) > 4) {
    g.moved = true
    emit('dragging', true)
  }
}
function onUp(e: PointerEvent): void {
  window.removeEventListener('pointermove', onMove)
  const g = ghost.value
  ghost.value = undefined
  if (!g?.moved) return
  emit('dragging', false)
  emit('drop', { x: e.clientX, y: e.clientY, payload: JSON.stringify(g.item) })
}
/** Jira estimate if it is sensible (≤ 4 h), else the chosen duration. */
const taskMinutes = (sec?: number) => (sec && sec <= 4 * 3600 ? Math.max(15, Math.round(sec / 60 / 15) * 15) : minutes.value)

async function addLunch(): Promise<void> {
  const l = props.schedule.lunch
  if (!l) return
  await window.qa.savePlan(props.day, { id: crypto.randomUUID(), start: l[0], end: l[1], kind: 'lunch', label: kindLabel('lunch') })
  emit('changed')
}
async function clearPlan(): Promise<void> {
  for (const p of props.plan) await window.qa.deletePlan(props.day, p.id)
  emit('select', undefined)
  emit('changed')
}

// ---------- the selected plan block ----------
const sel = computed(() => props.plan.find((p) => p.id === props.selectedId))
const editLabel = ref('')
watch(
  () => sel.value?.id,
  () => (editLabel.value = sel.value?.label ?? ''),
  { immediate: true },
)
async function update(patch: Partial<PlanBlock>): Promise<void> {
  const p = sel.value
  if (!p) return
  const next = { ...p, ...patch, task: plainTask(patch.task ?? p.task) }
  if (!(next.end > next.start)) return
  await window.qa.savePlan(props.day, next)
  emit('changed')
}
async function remove(): Promise<void> {
  const p = sel.value
  if (!p) return
  await window.qa.deletePlan(props.day, p.id)
  emit('select', undefined)
  emit('changed')
}
/** The plan came true: a real block for the same time (the plan stays for comparison). */
async function done(): Promise<void> {
  const p = sel.value
  if (!p) return
  await window.qa.planDone(props.day, p.id)
  emit('changed')
}
</script>

<template>
  <div class="plan tw:flex tw:flex-col tw:gap-10">
    <div class="ph tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
      <Icon name="calendar" :size="16" />
      <b class="tw:text-[14px]">План дня</b>
      <span v-if="workMs" class="muted small tw:text-[12px]">запланировано {{ formatDuration(plannedWork) }} из {{ formatDuration(workMs) }}</span>
      <span class="spacer tw:flex-1"></span>
      <button class="ib tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Закрыть планирование" @click="emit('close')"><Icon name="x" :size="14" /></button>
    </div>

    <!-- the selected plan block -->
    <div v-if="sel" class="sel tw:flex tw:flex-col tw:gap-8 tw:p-10 tw:rounded-[4px] tw:border-1.5 tw:border-dashed tw:border-accent/60 tw:bg-accent/7">
      <div class="srow tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
        <span class="kic tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-r2 tw:text-text-hi" :style="{ background: kindColor(sel.kind) }"><Icon :name="entryIcon(sel)" :size="12" /></span>
        <input v-model="editLabel" class="lbl tw:flex-1 tw:py-5 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px]" spellcheck="false" @change="update({ label: editLabel })" @keydown.enter="update({ label: editLabel })" />
      </div>
      <div class="srow tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
        <TimeRange boxed :start="sel.start" :end="sel.end" @change="(r) => update({ start: r.start, end: r.end })" />
      </div>
      <div v-if="sel.task" class="muted small tline tw:flex tw:items-center tw:gap-6 tw:text-[12px]"><Icon name="jira" :size="12" />{{ sel.task.key }} · {{ labelWithoutKey(sel.task.summary, sel.task.key) }}</div>
      <div class="kinds">
        <button class="tw:border-0 tw:rounded-none tw:bg-transparent tw:py-4 tw:px-10 tw:text-[12px] tw:text-muted tw:[&.on]:text-text-hi" v-for="k in planKinds" :key="k.id" :class="{ on: sel.kind === k.id }" :style="sel.kind === k.id ? { background: k.color } : {}" :title="k.label" @click="update({ kind: k.id })">
          <Icon :name="k.icon" :size="13" />
        </button>
      </div>
      <div class="srow tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
        <button class="ok tw:text-up tw:inline-flex tw:items-center tw:gap-5 tw:text-[12px] tw:py-4 tw:px-10" title="Создать настоящий блок на это время" @click="done"><Icon name="check" :size="14" />Сделано по плану</button>
        <button class="danger tw:text-down-fg tw:inline-flex tw:items-center tw:gap-5 tw:text-[12px] tw:py-4 tw:px-10" @click="remove"><Icon name="trash" :size="13" />Удалить</button>
        <span class="spacer tw:flex-1"></span>
        <button class="ib tw:border-0 tw:bg-transparent tw:text-muted tw:inline-flex tw:items-center tw:gap-5 tw:text-[12px] tw:py-4 tw:px-10 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Снять выделение" @click="emit('select', undefined)"><Icon name="x" :size="13" /></button>
      </div>
    </div>

    <div class="tools tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
      <span class="muted small tw:text-[12px]">Длительность</span>
      <OffsetField v-model="minutes" unsigned :step="15" :max="720" />
      <span class="spacer tw:flex-1"></span>
      <button class="tw:inline-flex tw:items-center tw:gap-5 tw:text-[12px] tw:py-4 tw:px-10" v-if="schedule.lunch && !hasLunch" @click="addLunch"><Icon name="utensils" :size="13" />Обед по графику</button>
      <button v-if="plan.length" class="dim tw:text-muted tw:inline-flex tw:items-center tw:gap-5 tw:text-[12px] tw:py-4 tw:px-10" @click="clearPlan">Очистить план</button>
    </div>

    <p class="muted small hint tw:text-[12px] tw:m-0">Перетащите вид занятости или задачу на дорожку «План» таймлайна. Блоки плана двигаются и тянутся за края; клик — изменить.</p>

    <div class="pal tw:flex tw:flex-wrap tw:gap-6">
      <div
        v-for="k in planKinds"
        :key="k.id"
        class="item kind tw:inline-flex tw:items-center tw:gap-6 tw:py-5 tw:px-10 tw:rounded-[4px] tw:border-1.5 tw:border-dashed tw:border-(--c,color-mix(in_srgb,var(--info)_70%,transparent)) tw:bg-[color-mix(in_srgb,var(--c,var(--info))_16%,transparent)] tw:text-[12px] tw:cursor-grab tw:select-none tw:active:cursor-grabbing"
        
        :style="{ '--c': k.color }"
        :title="`Перетащите на таймлайн: ${k.label}, ${minutes} мин`"
        @pointerdown="startDrag($event, { kind: k.id, label: k.label, minutes: isKind(k.id, 'lunch') && schedule.lunch ? (schedule.lunch[1] - schedule.lunch[0]) / 60000 : minutes })"
      >
        <Icon :name="k.icon" :size="13" />{{ k.label }}
      </div>
      <div
        class="item kind custom tw:inline-flex tw:items-center tw:gap-6 tw:py-5 tw:px-10 tw:rounded-[4px] tw:border-1.5 tw:border-dashed tw:border-(--c,color-mix(in_srgb,var(--info)_70%,transparent)) tw:bg-[color-mix(in_srgb,var(--c,var(--info))_16%,transparent)] tw:text-[12px] tw:cursor-grab tw:select-none tw:active:cursor-grabbing"
        
        :class="{ off: !custom.trim() }"
        title="Своё название"
        @pointerdown="startDrag($event, { kind: 'task', label: custom.trim() || 'Задача', minutes })"
      >
        <Icon name="plus" :size="13" />
        <input class="tw:w-130 tw:border-0 tw:bg-transparent tw:text-text tw:[font:inherit] tw:outline-none" v-model="custom" placeholder="своё название…" spellcheck="false" @pointerdown.stop />
      </div>
    </div>

    <template v-if="jira.connected">
      <div class="th tw:flex tw:items-center tw:gap-8 tw:flex-wrap tw:text-[12px] tw:text-info-fg">
        <Icon name="jira" :size="13" /><span>Задачи Jira</span>
        <input v-model="q" class="search tw:ml-auto tw:w-160 tw:py-3 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12px]" placeholder="поиск" spellcheck="false" />
      </div>
      <div class="tasks tw:flex tw:flex-col tw:gap-4 tw:max-h-260 tw:overflow-auto">
        <div
          v-for="i in tasks"
          :key="i.key"
          class="item task tw:items-center tw:gap-6 tw:py-5 tw:px-10 tw:rounded-[4px] tw:border-1.5 tw:border-dashed tw:border-(--c,color-mix(in_srgb,var(--info)_70%,transparent)) tw:bg-[color-mix(in_srgb,var(--c,var(--info))_16%,transparent)] tw:text-[12px] tw:cursor-grab tw:select-none tw:active:cursor-grabbing tw:[--c:var(--info)] tw:flex"
          
          :title="`${i.key} — ${i.summary}${i.estimateSec ? ` · оценка ${Math.round(i.estimateSec / 60)} мин` : ''}`"
          @pointerdown="startDrag($event, { kind: 'task', label: `${i.key} ${i.summary}`, task: { key: i.key, summary: i.summary }, minutes: taskMinutes(i.estimateSec) })"
        >
          <b class="tw:flex-none tw:text-info-fg">{{ i.key }}</b>
          <span class="sum tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ i.summary }}</span>
          <span class="muted small tw:text-[12px]">{{ taskMinutes(i.estimateSec) }}м</span>
        </div>
        <p v-if="!tasks.length" class="muted small tw:text-[12px]">Нет задач — мои задачи Jira и отмеченные звёздочкой в «Задачах».</p>
      </div>
    </template>
    <Teleport to="body">
      <div v-if="ghost?.moved" class="ghost tw:fixed tw:z-5000 tw:pointer-events-none tw:py-4 tw:px-10 tw:rounded-r2 tw:border-1.5 tw:border-dashed tw:border-(--c) tw:bg-[color-mix(in_srgb,var(--c)_30%,var(--bg))] tw:text-text-hi tw:text-[12px] tw:whitespace-nowrap tw:[box-shadow:0_8px_20px_rgba(0,0,0,0.45)]" :style="{ left: `${ghost.x + 12}px`, top: `${ghost.y + 10}px`, '--c': kindColor(ghost.item.kind) }">
        <b class="tw:mr-4" v-if="ghost.item.task">{{ ghost.item.task.key }}</b>{{ ghost.item.task ? '' : ghost.item.label }} · {{ ghost.item.minutes }}м
      </div>
    </Teleport>
    <p v-if="plan.length" class="muted small tw:text-[12px]">В плане {{ plan.length }} · с {{ formatHM(Math.min(...plan.map((p) => p.start))) }} до {{ formatHM(Math.max(...plan.map((p) => p.end))) }}</p>
  </div>
</template>

<style scoped src="./PlanPanel.css"></style>
