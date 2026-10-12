<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { labelWithoutKey, pickableTasks, plainTask } from '@shared/jira'
import { plannedWithin } from '@shared/plan'
import { formatDuration, formatHM } from '@shared/timeline'
import type { Ms, PlanBlock } from '@shared/types'
import Icon from './Icon.vue'
import OffsetField from './OffsetField.vue'
import TimeField from './TimeField.vue'
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
  const nonLunch = props.plan.filter((p) => p.kind !== 'lunch')
  return plannedWithin(nonLunch, w[0], w[1])
})
const hasLunch = computed(() => {
  const l = props.schedule.lunch
  return !!l && props.plan.some((p) => p.kind === 'lunch' && p.start < l[1] && p.end > l[0])
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
  <div class="plan">
    <div class="ph">
      <Icon name="calendar" :size="16" />
      <b>План дня</b>
      <span v-if="workMs" class="muted small">запланировано {{ formatDuration(plannedWork) }} из {{ formatDuration(workMs) }}</span>
      <span class="spacer"></span>
      <button class="ib" title="Закрыть планирование" @click="emit('close')"><Icon name="x" :size="14" /></button>
    </div>

    <!-- the selected plan block -->
    <div v-if="sel" class="sel">
      <div class="srow">
        <span class="kic" :style="{ background: kindColor(sel.kind) }"><Icon :name="entryIcon(sel)" :size="12" /></span>
        <input v-model="editLabel" class="lbl" spellcheck="false" @change="update({ label: editLabel })" @keydown.enter="update({ label: editLabel })" />
      </div>
      <div class="srow">
        <TimeField compact :model-value="sel.start" :max="sel.end - 300000" @update:model-value="(t) => update({ start: t })" />
        <span class="muted">—</span>
        <TimeField compact :model-value="sel.end" :min="sel.start + 300000" @update:model-value="(t) => update({ end: t })" />
        <b>{{ formatDuration(sel.end - sel.start) }}</b>
      </div>
      <div v-if="sel.task" class="muted small tline"><Icon name="jira" :size="12" />{{ sel.task.key }} · {{ labelWithoutKey(sel.task.summary, sel.task.key) }}</div>
      <div class="kinds">
        <button v-for="k in planKinds" :key="k.id" :class="{ on: sel.kind === k.id }" :style="sel.kind === k.id ? { background: k.color } : {}" :title="k.label" @click="update({ kind: k.id })">
          <Icon :name="k.icon" :size="13" />
        </button>
      </div>
      <div class="srow">
        <button class="ok" title="Создать настоящий блок на это время" @click="done"><Icon name="check" :size="14" />Сделано по плану</button>
        <button class="danger" @click="remove"><Icon name="trash" :size="13" />Удалить</button>
        <span class="spacer"></span>
        <button class="ib" title="Снять выделение" @click="emit('select', undefined)"><Icon name="x" :size="13" /></button>
      </div>
    </div>

    <div class="tools">
      <span class="muted small">Длительность</span>
      <OffsetField v-model="minutes" unsigned :step="15" :max="720" />
      <span class="spacer"></span>
      <button v-if="schedule.lunch && !hasLunch" @click="addLunch"><Icon name="utensils" :size="13" />Обед по графику</button>
      <button v-if="plan.length" class="dim" @click="clearPlan">Очистить план</button>
    </div>

    <p class="muted small hint">Перетащите вид занятости или задачу на дорожку «План» таймлайна. Блоки плана двигаются и тянутся за края; клик — изменить.</p>

    <div class="pal">
      <div
        v-for="k in planKinds"
        :key="k.id"
        class="item kind"
        
        :style="{ '--c': k.color }"
        :title="`Перетащите на таймлайн: ${k.label}, ${minutes} мин`"
        @pointerdown="startDrag($event, { kind: k.id, label: k.label, minutes: k.id === 'lunch' && schedule.lunch ? (schedule.lunch[1] - schedule.lunch[0]) / 60000 : minutes })"
      >
        <Icon :name="k.icon" :size="13" />{{ k.label }}
      </div>
      <div
        class="item kind custom"
        
        :class="{ off: !custom.trim() }"
        title="Своё название"
        @pointerdown="startDrag($event, { kind: 'task', label: custom.trim() || 'Задача', minutes })"
      >
        <Icon name="plus" :size="13" />
        <input v-model="custom" placeholder="своё название…" spellcheck="false" @pointerdown.stop />
      </div>
    </div>

    <template v-if="jira.connected">
      <div class="th">
        <Icon name="jira" :size="13" /><span>Задачи Jira</span>
        <input v-model="q" class="search" placeholder="поиск" spellcheck="false" />
      </div>
      <div class="tasks">
        <div
          v-for="i in tasks"
          :key="i.key"
          class="item task"
          
          :title="`${i.key} — ${i.summary}${i.estimateSec ? ` · оценка ${Math.round(i.estimateSec / 60)} мин` : ''}`"
          @pointerdown="startDrag($event, { kind: 'task', label: `${i.key} ${i.summary}`, task: { key: i.key, summary: i.summary }, minutes: taskMinutes(i.estimateSec) })"
        >
          <b>{{ i.key }}</b>
          <span class="sum">{{ i.summary }}</span>
          <span class="muted small">{{ taskMinutes(i.estimateSec) }}м</span>
        </div>
        <p v-if="!tasks.length" class="muted small">Нет задач — мои задачи Jira и отмеченные звёздочкой в «Задачах».</p>
      </div>
    </template>
    <Teleport to="body">
      <div v-if="ghost?.moved" class="ghost" :style="{ left: `${ghost.x + 12}px`, top: `${ghost.y + 10}px`, '--c': kindColor(ghost.item.kind) }">
        <b v-if="ghost.item.task">{{ ghost.item.task.key }}</b>{{ ghost.item.task ? '' : ghost.item.label }} · {{ ghost.item.minutes }}м
      </div>
    </Teleport>
    <p v-if="plan.length" class="muted small">В плане {{ plan.length }} · с {{ formatHM(Math.min(...plan.map((p) => p.start))) }} до {{ formatHM(Math.max(...plan.map((p) => p.end))) }}</p>
  </div>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ph,
.srow,
.tools,
.th {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ph b {
  font-size: 14px;
}
.spacer {
  flex: 1;
}
.small {
  font-size: 12px;
}
.hint {
  margin: 0;
}
.ib {
  display: inline-flex;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.sel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  border: 1.5px dashed rgba(167, 139, 250, 0.6);
  background: rgba(139, 92, 246, 0.07);
}
.kic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #fff;
}
.lbl {
  flex: 1;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.kinds,
.durs {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  align-self: flex-start;
}
.kinds button,
.durs button {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--muted);
}
.kinds button.on {
  color: #fff;
}
.durs button.on {
  background: rgba(139, 92, 246, 0.3);
  color: var(--text);
}
.ok {
  color: #4ade80;
}
.danger {
  color: #f87171;
}
.dim {
  color: var(--muted);
}
.tools button,
.srow button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 4px 10px;
}
.pal {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1.5px dashed var(--c, rgba(96, 165, 250, 0.7));
  background: color-mix(in srgb, var(--c, #3b82f6) 16%, transparent);
  font-size: 12px;
  cursor: grab;
  user-select: none;
}
.item:active {
  cursor: grabbing;
}
.ghost {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  padding: 4px 10px;
  border-radius: 7px;
  border: 1.5px dashed var(--c);
  background: color-mix(in srgb, var(--c) 30%, #11131a);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
}
.ghost b {
  margin-right: 4px;
}
.custom input {
  width: 130px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  outline: none;
}
.th {
  font-size: 12px;
  color: #93c5fd;
}
.th .search {
  margin-left: auto;
  width: 160px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.tasks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 260px;
  overflow: auto;
}
.item.task {
  --c: #2684ff;
  display: flex;
}
.item.task b {
  flex: none;
  color: #93c5fd;
}
.sum {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
