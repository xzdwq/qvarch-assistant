<script setup lang="ts">
import { computed, ref, shallowRef, toRef, watch } from 'vue'
import { clipEntries, dayEnd, dayStart, formatDuration, HOUR, mergeIntervals, MINUTE, scheduleRanges, shiftDay } from '@shared/timeline'
import type { Entry, EntryKind, PublicSettings, Selection } from '@shared/types'
import EntryEditor, { type AddPrefs, type Draft } from '../components/EntryEditor.vue'
import Icon from '../components/Icon.vue'
import NoteList from '../components/NoteList.vue'
import NoteEditor from '../components/NoteEditor.vue'
import PlanPanel from '../components/PlanPanel.vue'
import EntryRecords from '../components/EntryRecords.vue'
import DayStrip from '../components/DayStrip.vue'
import SheetView from './SheetView.vue'
import { visibleNotes } from '@shared/notes'
import Timeline from '../components/Timeline.vue'
import { productiveMs } from '@shared/kinds'
import { kindColor, kindLabel, kinds } from '../lib/palette'
import { askSeries } from '../lib/seriesAsk'
import { recentLabels } from '../lib/recent'
import { useSelection } from '../lib/selection'
import { useDay } from '../lib/useDay'

const props = defineProps<{ day: string; settings: PublicSettings; focusEntry?: string }>()
const emit = defineEmits<{ openDay: [day: string, entryId?: string] }>()
const day = toRef(props, 'day')
const { data, live, now, isToday, cursor, reload } = useDay(day)
const sel = useSelection()

const prevEntries = shallowRef<Entry[]>([])
watch(day, async (d) => (prevEntries.value = (await window.qa.getDay(shiftDay(d, -1))).entries), { immediate: true })
const recent = computed(() => recentLabels(data.value.entries, prevEntries.value))

const schedule = computed(() => scheduleRanges(day.value, props.settings.schedule))
/** Not a work day by the schedule (Saturday/Sunday by default) — any work that day is weekend work. */
const dayOff = computed(() => !props.settings.schedule.workDays.includes(new Date(dayStart(day.value)).getDay()))

/** Default view: the work day ∪ the day's blocks, padded to whole hours. */
const initial = computed<[number, number]>(() => {
  const starts = data.value.entries.map((e) => e.start)
  const ends = [...data.value.entries.map((e) => e.end), ...(isToday.value ? [now.value] : [])]
  if (schedule.value.work) {
    starts.push(schedule.value.work[0])
    ends.push(schedule.value.work[1])
  }
  const from = starts.length ? Math.min(...starts) : dayStart(day.value) + 9 * HOUR
  const to = ends.length ? Math.max(...ends) : dayStart(day.value) + 18 * HOUR
  return [Math.max(dayStart(day.value), Math.floor((from - 15 * MINUTE) / HOUR) * HOUR), Math.min(dayEnd(day.value), Math.ceil((to + 15 * MINUTE) / HOUR) * HOUR)]
})
const bounds = computed<[number, number]>(() => [dayStart(day.value), dayEnd(day.value)])

// ---------- stats ----------

const stats = computed(() => {
  // only what already happened counts: planned blocks later today or on a future day (meetings) do not
  const d = { ...data.value, entries: clipEntries(data.value.entries, isToday.value ? now.value : Date.now()) }
  // parallel blocks are counted once
  const labelled = mergeIntervals(d.entries).reduce((s, e) => s + (e.end - e.start), 0)
  const calls = mergeIntervals(d.calls, MINUTE).reduce((s, c) => s + (c.end - c.start), 0)
  const byKind = new Map<EntryKind, number>()
  for (const e of d.entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + (e.end - e.start))
  const productive = productiveMs(d.entries, kinds.value)
  return { labelled, productive, calls, byKind: [...byKind.entries()] }
})

/** The day header: the main counters; the rest on demand (or always — Настройки → Интерфейс). */
/** All the day's figures or just two — the button switches the setting (so it is remembered). */
const showAllStats = computed(() => props.settings.ui.main.allStats)
function toggleStats(): void {
  void window.qa.updateSettings({ ui: { main: { allStats: !showAllStats.value } } })
}

const status = computed(() => {
  if (!isToday.value) return undefined
  const l = live.value
  return l.inCall ? { text: `Созвон${l.callApp ? ` · ${l.callApp}` : ''}`, cls: 'call' } : undefined
})

// ---------- selection / editor ----------

const selectedId = ref<string>()
const tab = ref<'entries' | 'notes' | 'sheet'>('entries')
const notes = computed(() => visibleNotes(data.value.notes))
/** The note being written / edited in the notes tab. */
const noteDraft = ref<{ id: string; at: number; text: string; isNew?: boolean; taskId?: string }>()
/** "План дня": the plan panel on the left, the plan lane on the timeline accepts drops. */
const planMode = ref(false)
const planDragging = ref(false)
const timeline = ref<InstanceType<typeof Timeline>>()
/** A palette item released: a plan block where it landed on the plan lane (elsewhere — nothing). */
function onPaletteDrop(d: { x: number; y: number; payload: string }): void {
  const t = timeline.value?.planTimeAt(d.x, d.y)
  if (t !== undefined) void onPlanDrop({ t, payload: d.payload })
}
const selectedPlanId = ref<string>()
async function onPlanDrop(d: { t: number; payload: string }): Promise<void> {
  try {
    const item = JSON.parse(d.payload) as { kind: string; label: string; task?: { key: string; summary: string }; minutes: number }
    const start = d.t
    const end = Math.min(dayEnd(day.value), start + Math.max(5, item.minutes) * MINUTE)
    const id = crypto.randomUUID()
    await window.qa.savePlan(day.value, { id, start, end, kind: item.kind, label: item.label, task: item.task ? { key: item.task.key, summary: item.task.summary } : undefined })
    selectedPlanId.value = id
    planMode.value = true
    await reload()
  } catch {
    // not a plan item
  }
}
async function onPlanChange(c: { id: string; start: number; end: number }): Promise<void> {
  const p = data.value.plan?.find((x) => x.id === c.id)
  if (!p) return
  await window.qa.savePlan(day.value, { ...p, task: p.task ? { ...p.task } : undefined, start: c.start, end: c.end })
  await reload()
}
function onPlanSelect(id: string | undefined): void {
  selectedPlanId.value = id
  if (id) planMode.value = true
}

/** The moment last clicked on the timeline. */
const pinAt = ref<number>()
watch(pinAt, (t) => {
  // only a note being written right now — an existing one (or a recording) keeps its moment
  if (t !== undefined && noteDraft.value?.isNew) noteDraft.value = { ...noteDraft.value, at: t }
})
/** New note: now (today), else at the selected block / marker, else midday. A timeline click while it is open moves it. */
function newNote(): void {
  tab.value = 'notes'
  const e = data.value.entries.find((x) => x.id === selectedId.value)
  const at = isToday.value ? now.value : (e?.start ?? marker.value?.start ?? dayStart(day.value) + 12 * HOUR)
  noteDraft.value = { id: crypto.randomUUID(), at, text: '', isNew: true }
}
/** A pin on the timeline: opens the note, a second click closes it (the editor saves on its way out). */
function toggleNote(n: { id: string; at: number; text: string; taskId?: string }): void {
  if (noteDraft.value?.id === n.id) {
    noteDraft.value = undefined
    setTimeout(() => void reload(), 300)
    return
  }
  tab.value = 'notes'
  editNote(n)
}
/** A note in the list: opens in place; a second click on it closes it. */
function editNote(n: { id: string; at: number; text: string; taskId?: string }): void {
  if (noteDraft.value?.id === n.id) {
    noteDraft.value = undefined
    setTimeout(() => void reload(), 300)
    return
  }
  noteDraft.value = { id: n.id, at: n.at, text: n.text, taskId: n.taskId }
}
async function onNoteClosed(): Promise<void> {
  noteDraft.value = undefined
  await reload()
}
async function noteToTask(id: string): Promise<void> {
  await window.qa.noteToTask(day.value, id)
  await reload()
}
async function deleteNote(id: string): Promise<void> {
  await window.qa.deleteNote(day.value, id)
  await reload()
}
const editor = ref<InstanceType<typeof EntryEditor>>()

const marker = computed<Selection | null>(() => (sel.selection.value?.day === day.value ? sel.selection.value : null))

/** A new block without a range picked on the timeline: from now / the cursor, forward / back, N minutes. */
const add = ref<AddPrefs>(readAdd())
function readAdd(): AddPrefs {
  try {
    const v = JSON.parse(localStorage.getItem('qa.add') ?? '{}') as Partial<AddPrefs>
    return { from: v.from === 'cursor' ? 'cursor' : 'now', back: !!v.back, min: Math.min(720, Math.max(1, Math.round(v.min ?? 30))) || 30 }
  } catch {
    return { from: 'now', back: false, min: 30 }
  }
}
watch(add, (v) => {
  try {
    localStorage.setItem('qa.add', JSON.stringify(v))
  } catch {
    // not remembered — fine
  }
})
/** The anchor: the cursor if asked for and set, else now (today) / the cursor / 09:00. */
const addBase = computed(() => {
  // a cursor from another day (it was clicked before switching days) does not count
  const pin = pinAt.value !== undefined && pinAt.value >= dayStart(day.value) && pinAt.value < dayEnd(day.value) ? pinAt.value : undefined
  const base = add.value.from === 'cursor' && pin !== undefined ? pin : isToday.value ? now.value : (pin ?? dayStart(day.value) + 9 * HOUR)
  return Math.floor(base / MINUTE) * MINUTE
})
/** "Back from now" follows the time (the last N minutes, up to now). */
const addFromNow = computed(() => isToday.value && !(add.value.from === 'cursor' && pinAt.value !== undefined))
const addFollowsNow = computed(() => add.value.back && addFromNow.value)

const editing = computed<Draft | undefined>(() => {
  const e = data.value.entries.find((x) => x.id === selectedId.value)
  if (e) return e
  const m = marker.value
  if (!m) {
    const b = addBase.value
    const span = add.value.min * MINUTE
    return {
      start: add.value.back ? Math.max(dayStart(day.value), b - span) : b,
      end: add.value.back ? b : Math.min(dayEnd(day.value), b + span),
      followsNow: addFollowsNow.value,
      startsNow: !add.value.back && addFromNow.value,
      kind: 'task',
      label: '',
      source: 'manual',
    }
  }
  return {
    start: m.start,
    end: m.end ?? now.value,
    followsNow: !m.end,
    kind: 'task',
    label: '',
    source: 'manual',
  }
})

watch(day, () => (pinAt.value = undefined))
watch(
  () => props.focusEntry,
  (id) => id && select(id),
  { immediate: true },
)

function select(id: string): void {
  selectedId.value = id
}

/** Click on a block of the timeline: with a marker it means "continue that topic" (copy kind/text). */
function onTimelineSelect(id: string): void {
  const entry = data.value.entries.find((e) => e.id === id)
  if (marker.value && !selectedId.value && entry) {
    editor.value?.copyFrom(entry)
    return
  }
  select(id)
}

/** Right-click → kind: cut the marker as that kind right away. */
async function cutAs(kind: string): Promise<void> {
  const m = marker.value
  if (!m) return
  await window.qa.saveEntry(day.value, {
    start: m.start,
    end: m.end ?? now.value,
    kind,
    label: kindLabel(kind),
    source: 'manual',
  }, { overlap: true })
  sel.clear()
  await reload()
}

/** A block dragged to another time: overlaps with other blocks are kept (shown in parallel). */
async function moveEntry(c: { id: string; start: number; end: number; lane: number }): Promise<void> {
  const e = data.value.entries.find((x) => x.id === c.id)
  if (!e) return
  await window.qa.saveEntry(day.value, { ...e, start: c.start, end: c.end, lane: c.lane }, { overlap: true })
  await reload()
}

async function mergeEntries(ids: string[]): Promise<void> {
  const merged = await window.qa.mergeEntries(day.value, ids)
  await reload()
  if (merged) selectedId.value = merged.id
}

/** The follow-the-time switch is a setting (remembered; applies at once — settings come back by IPC). */
async function window_follow(on: boolean): Promise<void> {
  await window.qa.updateSettings({ ui: { timeline: { follow: on } } })
}
async function deleteEntry(id: string): Promise<void> {
  const e = data.value.entries.find((x) => x.id === id)
  if (e?.outlook) return
  if (e?.series) {
    const scope = await askSeries('delete')
    if (!scope) return
    if (scope === 'all') await window.qa.seriesDelete(day.value, id)
    else await window.qa.deleteEntry(day.value, id)
  } else await window.qa.deleteEntry(day.value, id)
  if (selectedId.value === id) selectedId.value = undefined
  await reload()
}

async function changeKind(c: { id: string; kind: string }): Promise<void> {
  const e = data.value.entries.find((x) => x.id === c.id)
  if (!e || e.outlook) return
  // keep a custom label, but follow the kind if the label was just the old kind's name
  const label = e.label === kindLabel(e.kind) ? kindLabel(c.kind) : e.label
  await window.qa.saveEntry(day.value, { ...e, kind: c.kind, label }, { overlap: true })
  await reload()
}

function onSelection(s: Selection | null, commit: boolean): void {
  selectedId.value = undefined
  if (commit) sel.commit(s)
  else sel.preview(s)
}


function onEditorRange(r: { start: number; end: number; followsNow: boolean }): void {
  sel.commit({ day: day.value, start: r.start, end: r.followsNow ? undefined : r.end })
}

async function resize(c: { id: string; start: number; end: number }): Promise<void> {
  const e = data.value.entries.find((x) => x.id === c.id)
  if (!e) return
  await window.qa.saveEntry(day.value, { ...e, start: c.start, end: c.end }, { overlap: true })
  await reload()
}


async function onSaved(e: Entry): Promise<void> {
  if (!editing.value?.id) sel.clear()
  selectedId.value = e.id
  await reload()
}

async function onDeleted(): Promise<void> {
  selectedId.value = undefined
  await reload()
}

function closeEditor(): void {
  if (selectedId.value) selectedId.value = undefined
  else sel.clear()
}

</script>

<template>
  <div class="day">
    <div class="top">
      <div class="total">
        <span class="muted">Размечено</span>
        <b>{{ formatDuration(stats.labelled) }}</b>
      </div>
      <Transition name="fade" mode="out-in">
        <span v-if="status" :key="status.cls" class="status" :class="status.cls">{{ status.text }}</span>
      </Transition>
      <span v-if="dayOff" class="status weekend" :title="stats.labelled ? 'В выходной была работа' : 'Выходной по графику'">
        {{ stats.labelled ? 'Работа в выходной' : 'Выходной' }}
      </span>
      <div class="stats">
        <span title="Без непродуктивных видов"><i style="background: #a3e635"></i>Продуктивно <b>{{ formatDuration(stats.productive) }}</b></span>
        <span><i style="background: #14b8a6"></i>Созвоны <b>{{ formatDuration(stats.calls) }}</b></span>
        <template v-if="showAllStats">
          <span v-for="[k, ms] in stats.byKind" :key="k"><i :style="{ background: kindColor(k) }"></i>{{ kindLabel(k) }} <b>{{ formatDuration(ms) }}</b></span>
        </template>
        <button class="more" :title="showAllStats ? 'Свернуть' : 'Все показатели дня'" @click="toggleStats">
          {{ showAllStats ? 'меньше' : `ещё ${stats.byKind.length}` }}
        </button>
      </div>
      <span class="spacer"></span>
      <span class="actions">
        <button v-if="settings.ui.main.plan" class="act act-plan" :class="{ on: planMode }" title="План дня" aria-label="План дня" @click="planMode = !planMode">
          <Icon name="calendar" :size="16" />
        </button>
        <button class="act act-note" title="Новая заметка" aria-label="Новая заметка" @click="newNote"><Icon name="note" :size="16" /><span>Заметка</span></button>
      </span>
    </div>

    <Timeline
      :data="data"
      :now="isToday ? now : undefined"
      :cursor="cursor"
      :schedule="schedule"
      :bounds="bounds"
      :initial="initial"
      :selection="marker"
      :selected-id="selectedId"
      @select="onTimelineSelect"
      @selection="onSelection"
      @resize="resize"
      @cut-as="cutAs"
      @change-kind="changeKind"
      @delete-entry="deleteEntry"
      @move="moveEntry"
      @merge="mergeEntries"
      :active-note-id="noteDraft?.id"
      ref="timeline"
      :plan-mode="planMode"
      :plan-dragging="planDragging"
      :selected-plan-id="selectedPlanId"
      @plan-change="onPlanChange"
      @plan-select="onPlanSelect"
      @plan-changed="reload"
      @note="toggleNote"
      @pin="(t) => (pinAt = t)"
      :follow="settings.ui.timeline"
      :view-key="`day:${day}`"
      @follow="(on) => void window_follow(on)"
    />
    <!-- the day as a chain of events (as under the dashboard's timeline) -->
    <DayStrip class="dstrip" :entries="data.entries" :now="now" :countdown="settings.ui.timeline.countdown" />

    <div class="bottom">
      <section class="left">
        <Transition name="fade" mode="out-in">
          <PlanPanel
            v-if="planMode"
            :day="day"
            :plan="data.plan ?? []"
            :schedule="schedule"
            :selected-id="selectedPlanId"
            @changed="reload"
            @select="(id) => (selectedPlanId = id)"
            @close="planMode = false"
            @drop="onPaletteDrop"
            @dragging="(on) => (planDragging = on)"
          />
          <EntryEditor
            v-else-if="editing"
            ref="editor"
            :key="editing.id ?? 'draft'"
            :day="day"
            :entry="editing"
            :recent="recent"
            :now="isToday ? now : undefined"
            :entries="data.entries"
            :notes="data.notes"
            textarea
            :add="!editing.id && !marker ? add : undefined"
            :has-cursor="pinAt !== undefined"
            @update:add="(a) => (add = a)"
            @saved="onSaved"
            @deleted="onDeleted"
            @close="closeEditor"
            @range="onEditorRange"
          />
        </Transition>
      </section>

      <section class="right">
        <nav class="tabs">
          <button :class="{ on: tab === 'entries' }" @click="tab = 'entries'">Записи ({{ data.entries.length }})</button>
          <button :class="{ on: tab === 'notes' }" @click="tab = 'notes'">Заметки ({{ notes.length }})</button>
          <button :class="{ on: tab === 'sheet' }" @click="tab = 'sheet'">Заполнение</button>
        </nav>

        <Transition name="fade" mode="out-in">
          <div :key="tab">
            <div v-if="tab === 'entries'" class="list">
              <EntryRecords :data="data" :selected-id="selectedId" @select="select" @changed="reload" />
            </div>

            <div v-else-if="tab === 'sheet'" class="sheet-tab">
              <SheetView :settings="settings" widget store="day" :day="day" @go="(_v, d, id) => d && emit('openDay', d, id)" />
            </div>

            <div v-else-if="tab === 'notes'" class="notes-tab">
              <!-- a new note is written at the top; an existing one opens in place in the list -->
              <NoteEditor v-if="noteDraft?.isNew" :key="noteDraft.id" :day="day" :note="noteDraft" :entries="data.entries" :notes="data.notes" :full="data.notes.find((x) => x.id === noteDraft!.id)" @close="onNoteClosed" @saved="reload" />
              <button v-else class="note-add" @click="newNote"><Icon name="plus" :size="14" />Новая заметка</button>
              <NoteList
                v-if="notes.length"
                :notes="noteDraft?.isNew ? notes.filter((n) => n.id !== noteDraft!.id) : notes"
                :entries="data.entries"
                :editing-id="noteDraft?.isNew ? undefined : noteDraft?.id"
                :day="day"
                deletable
                editable
                @delete="deleteNote"
                @select="select"
                @edit="editNote"
                @to-task="(n) => void noteToTask(n.id)"
              >
                <template #editor>
                  <NoteEditor v-if="noteDraft" :key="noteDraft.id" :day="day" :note="noteDraft" :entries="data.entries" :notes="data.notes" :full="data.notes.find((x) => x.id === noteDraft!.id)" @close="onNoteClosed" @saved="reload" />
                </template>
              </NoteList>
              <p v-else-if="!noteDraft" class="muted">Заметок нет. Их можно добавить здесь, в острове или кликом по сфере в мини-острове.</p>
            </div>
          </div>
        </Transition>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* the action buttons wrap as one group, never one by one */
.actions {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
/* quiet icon buttons; only "Заметка" — the everyday action — keeps its word */
.act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
}
.act:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.act-plan.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--accent-fg);
}
.act-ai {
  color: var(--accent-fg);
}
.act-ai.busy {
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}
.act-note {
  padding: 0 12px;
  border-color: rgba(255, 183, 77, 0.35);
  background: rgba(255, 183, 77, 0.08);
  color: var(--warn-fg);
}
.act-note:hover {
  background: rgba(255, 183, 77, 0.16);
  color: var(--warn-fg);
}
.stats .more {
  padding: 1px 8px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.dfilter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.dseg {
  display: inline-flex;
  padding: 2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}
.dseg button {
  padding: 3px 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.dseg button.on {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}
.dseg button:disabled {
  opacity: 0.4;
}
.ell {
  min-width: 0;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lnk {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--accent-fg);
}
.ai-tab {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-tab .err {
  color: var(--down-fg);
}
.ai-tab .small {
  font-size: 11px;
}
.sheet-tab {
  height: 480px;
  margin: 0 -16px -14px;
}
.dstrip {
  margin-top: -6px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
}
.notes-tab {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.note-add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 13px;
}
.day {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 20px;
}
.top {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.total {
  display: flex;
  flex-direction: column;
}
.total .muted {
  font-size: 11px;
}
.total b {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  line-height: 1.1;
}
.status {
  padding: 4px 12px;
  border-radius: var(--r2);
  font-size: 12px;
  font-weight: 600;
}
.status.work {
  background: rgba(0, 230, 118, 0.15);
  color: var(--up);
}
.status.idle {
  background: rgba(127, 139, 157, 0.15);
  color: var(--text-2);
}
.status.weekend {
  background: rgba(255, 183, 77, 0.15);
  color: var(--warn);
}
.status.call {
  background: rgba(20, 184, 166, 0.18);
  color: #5eead4;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12px;
  color: var(--muted);
}
.stats span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.stats b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.stats .warn b {
  color: var(--warn);
}
i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.spacer {
  flex: 1;
}
.bottom {
  display: grid;
  grid-template-columns: minmax(360px, 430px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
/* a narrow window: the panels stack */
@media (max-width: 900px) {
  .bottom {
    grid-template-columns: minmax(0, 1fr);
  }
}
section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--r3);
  padding: 14px 16px;
  min-height: 200px;
  min-width: 0;
}
.empty {
  text-align: center;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
}
.empty .big {
  color: var(--accent);
  opacity: 0.8;
}
.top button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.empty p {
  margin: 6px 0;
}
.tabs {
  display: flex;
  gap: 4px;
  margin: -4px 0 14px;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  margin-bottom: -1px;
  transition: border-color 0.2s, color 0.2s;
  color: var(--muted);
}
.tabs button.on {
  border-bottom-color: var(--accent);
  color: var(--text);
}
.list {
  display: flex;
  flex-direction: column;
  max-height: 420px;
  overflow: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r2);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.row:hover {
  background: var(--hover);
}
.row.selected {
  background: var(--panel-2);
  box-shadow: inset 2px 0 0 var(--accent);
}
.time,
.dur {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  white-space: nowrap;
}
/* records: icon | when (time + duration) | what */
.esum {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 2px 8px 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
}
.esum b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.esum .ov {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--warn);
}
.esum .ov b {
  color: var(--warn);
}
.eic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--r2);
  color: var(--text-hi);
}
.when {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 92px;
  padding-right: 10px;
  border-right: 1px solid var(--border);
  line-height: 1.25;
}
.when .time {
  font-size: 12.5px;
  color: var(--text-2);
}
.when .dur {
  font-size: 11px;
  color: var(--muted);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.lbl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11.5px;
}
.row.par .when {
  border-right-color: rgba(255, 183, 77, 0.55);
}
.ol {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--r2);
  background: var(--info);
}
.jl {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--info-fg);
}
.jl:hover {
  background: rgba(68, 138, 255, 0.15);
}
.orow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -2px 0 4px 38px;
  padding: 4px 8px;
  border-radius: var(--r2);
  border-left: 2px solid rgba(255, 183, 77, 0.6);
  background: rgba(255, 183, 77, 0.06);
  color: var(--warn-fg);
  font-size: 11.5px;
}
.orow > span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orow .otime {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  color: var(--muted);
  white-space: nowrap;
}
.orow .odur {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  color: var(--warn);
  white-space: nowrap;
}
.grow {
  flex: 1;
}
.key {
  color: var(--info-fg);
  font-weight: 600;
  font-size: 12px;
}
.ai {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--r2);
  background: var(--accent);
}
.dur {
  color: var(--muted);
}
</style>
