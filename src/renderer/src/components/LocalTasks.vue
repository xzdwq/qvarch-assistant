<script setup lang="ts">
import SuggestInput from './SuggestInput.vue'
import { computed, onBeforeUnmount, ref, reactive } from 'vue'
import type { LocalTask } from '@shared/types'
import Icon from './Icon.vue'
import DatePick from './DatePick.vue'

/**
 * Own tasks (besides Jira): quick add, status, due date, project (from the ones used before), estimate,
 * and the note a task was made from. Grouped by project, by due date.
 */
const props = defineProps<{ showDone: boolean; q: string }>()
const emit = defineEmits<{ openDay: [day: string] }>()

const tasks = ref<LocalTask[]>([])
void window.qa.tasks().then((t) => (tasks.value = t))
const off = window.qa.onTasks((t) => (tasks.value = t))
onBeforeUnmount(off)

const STATUSES: Array<{ id: LocalTask['status']; label: string }> = [
  { id: 'todo', label: 'К выполнению' },
  { id: 'progress', label: 'В работе' },
  { id: 'review', label: 'Ревью' },
  { id: 'done', label: 'Готово' },
]
/** A task's project as it is being typed (its suggestions — the projects there are). */
const projDraft = reactive<Record<string, string>>({})
function setProject(t: LocalTask, v: string): void {
  delete projDraft[t.id]
  const p = v.trim() || undefined
  if (p !== t.project) patch(t, { project: p })
}
const projects = computed(() => [...new Set(tasks.value.map((t) => t.project).filter((p): p is string => !!p))].sort())
const today = new Date().toLocaleDateString('sv-SE')

const groups = computed(() => {
  const s = props.q.trim().toLowerCase()
  const list = tasks.value.filter(
    (t) => (props.showDone || t.status !== 'done') && (!s || t.title.toLowerCase().includes(s) || (t.description ?? '').toLowerCase().includes(s) || (t.project ?? '').toLowerCase().includes(s)),
  )
  const by = new Map<string, LocalTask[]>()
  for (const t of list) by.set(t.project ?? '', [...(by.get(t.project ?? '') ?? []), t])
  const order = { progress: 0, review: 1, todo: 2, done: 3 }
  for (const g of by.values()) g.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || order[a.status] - order[b.status] || b.created - a.created)
  return [...by.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
})

const title = ref('')
async function add(): Promise<void> {
  if (!title.value.trim()) return
  await window.qa.saveTask({ id: crypto.randomUUID(), title: title.value.trim(), status: 'todo', created: Date.now() })
  title.value = ''
}
async function patch(t: LocalTask, p: Partial<LocalTask>): Promise<void> {
  await window.qa.saveTask(JSON.parse(JSON.stringify({ ...t, ...p })) as LocalTask)
}
async function remove(t: LocalTask): Promise<void> {
  if (confirm(`Удалить задачу «${t.title}»?`)) await window.qa.deleteTask(t.id)
}
const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
const open = ref<string>()
</script>

<template>
  <section class="lt">
    <h3><Icon name="checkSquare" :size="15" />Мои задачи <span class="muted">{{ tasks.filter((t) => t.status !== 'done').length }} открыто</span></h3>
    <div class="add">
      <input v-model="title" placeholder="Новая задача — Enter" spellcheck="false" @keydown.enter="add" />
      <button :disabled="!title.trim()" @click="add"><Icon name="plus" :size="14" />Добавить</button>
    </div>

    <template v-for="[proj, list] in groups" :key="proj">
      <div class="proj">{{ proj || 'Без проекта' }}</div>
      <div v-for="t in list" :key="t.id" class="row" :class="[t.status]">
        <select :value="t.status" class="st" @change="patch(t, { status: ($event.target as HTMLSelectElement).value as LocalTask['status'] })">
          <option v-for="s in STATUSES" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <span class="tkey" title="Номер задачи">{{ t.key }}</span>
        <input class="title" :value="t.title" spellcheck="false" @change="patch(t, { title: ($event.target as HTMLInputElement).value })" />
        <SuggestInput class="projin" :model-value="projDraft[t.id] ?? t.project ?? ''" :options="projects" placeholder="проект" @update:model-value="(v) => (projDraft[t.id] = v)" @commit="(v) => setProject(t, v)" @cancel="delete projDraft[t.id]" />
        <DatePick class="due" :model-value="t.due ?? ''" clearable no-wheel format="short" placeholder="срок" title="Срок" :late="!!t.due && t.due < today && t.status !== 'done'" @update:model-value="(d) => patch(t, { due: d || undefined })" />
        <input class="est" type="number" min="0" step="15" :value="t.estimateMin ?? ''" placeholder="мин" title="Оценка, минут" @change="patch(t, { estimateMin: Number(($event.target as HTMLInputElement).value) || undefined })" />
        <button v-if="t.from" class="from" :title="`Создана из заметки — открыть ${fmtDay(t.from.day)}`" @click="emit('openDay', t.from.day)"><Icon name="note" :size="12" />{{ fmtDay(t.from.day) }}</button>
        <span v-else></span>
        <button class="more" :title="t.description ? 'Описание' : 'Добавить описание'" @click="open = open === t.id ? undefined : t.id"><Icon :name="open === t.id ? 'chevronDown' : 'chevronRight'" :size="13" /></button>
        <button class="del" title="Удалить" @click="remove(t)"><Icon name="trash" :size="13" /></button>
        <textarea v-if="open === t.id" class="desc" :value="t.description ?? ''" rows="3" placeholder="Описание" spellcheck="false" @change="patch(t, { description: ($event.target as HTMLTextAreaElement).value.trim() || undefined })"></textarea>
      </div>
    </template>
    <p v-if="!groups.length" class="muted small">Задач нет. Добавьте строкой выше или кнопкой «В задачу» у любой заметки.</p>
  </section>
</template>

<style scoped>
.tkey {
  color: var(--accent-fg);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.lt {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 4px;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
h3 .muted {
  font-weight: 400;
  font-size: 12px;
}
.add {
  display: flex;
  gap: 8px;
}
.add input {
  flex: 1;
}
.add button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
input,
select,
textarea {
  padding: 4px 8px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.proj {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.row {
  display: grid;
  grid-template-columns: 130px auto minmax(0, 1fr) 130px 130px 70px 74px 26px 26px;
  gap: 8px;
  align-items: center;
}
.row.done .title {
  text-decoration: line-through;
  opacity: 0.55;
}
.st {
  font-size: 12px;
}
.row.progress .st {
  color: var(--info-fg);
}
.row.review .st {
  color: var(--accent-fg);
}
.row.done .st {
  color: var(--up-fg);
}
.due.late {
  color: var(--down-fg);
  border-color: rgba(255, 61, 61, 0.5);
}
.from,
.more,
.del {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.from {
  color: var(--warn);
}
.del:hover {
  color: var(--down-fg);
}
.desc {
  grid-column: 2 / -1;
  resize: vertical;
}
.small {
  font-size: 12px;
}
</style>
