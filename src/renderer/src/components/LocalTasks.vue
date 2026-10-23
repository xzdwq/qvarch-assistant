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
  <section class="lt tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-10 tw:px-14 tw:flex tw:flex-col tw:gap-6">
    <h3 class="tw:flex tw:items-center tw:gap-8 tw:mt-2 tw:mr-0 tw:mb-4 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2"><Icon name="checkSquare" :size="15" />Мои задачи <span class="muted tw:font-normal tw:text-[12px]">{{ tasks.filter((t) => t.status !== 'done').length }} открыто</span></h3>
    <div class="add tw:flex tw:gap-8">
      <input class="tw:flex-1 tw:py-4 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px]" v-model="title" placeholder="Новая задача — Enter" spellcheck="false" @keydown.enter="add" />
      <button class="tw:inline-flex tw:items-center tw:gap-5" :disabled="!title.trim()" @click="add"><Icon name="plus" :size="14" />Добавить</button>
    </div>

    <template v-for="[proj, list] in groups" :key="proj">
      <div class="proj tw:mt-6 tw:text-[12px] tw:text-muted">{{ proj || 'Без проекта' }}</div>
      <div v-for="t in list" :key="t.id" class="row tw:group/row tw:grid tw:grid-cols-[130px_auto_minmax(0,1fr)_130px_130px_70px_74px_26px_26px] tw:gap-8 tw:items-center" :class="[t.status]">
        <select :value="t.status" class="st tw:py-4 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12px] tw:group-[.progress]/row:not-group-[.review]/row:not-group-[.done]/row:text-info-fg tw:group-[.review]/row:not-group-[.done]/row:text-accent-fg tw:group-[.done]/row:text-up-fg" @change="patch(t, { status: ($event.target as HTMLSelectElement).value as LocalTask['status'] })">
          <option v-for="s in STATUSES" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <span class="tkey tw:text-accent-fg tw:text-[12px] tw:font-semibold tw:whitespace-nowrap" title="Номер задачи">{{ t.key }}</span>
        <input class="title tw:py-4 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px] tw:group-[.done]/row:line-through tw:group-[.done]/row:opacity-[0.55]" :value="t.title" spellcheck="false" @change="patch(t, { title: ($event.target as HTMLInputElement).value })" />
        <SuggestInput class="projin tw:py-4 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px]" :model-value="projDraft[t.id] ?? t.project ?? ''" :options="projects" placeholder="проект" @update:model-value="(v) => (projDraft[t.id] = v)" @commit="(v) => setProject(t, v)" @cancel="delete projDraft[t.id]" />
        <DatePick class="due" :model-value="t.due ?? ''" clearable no-wheel format="short" placeholder="срок" title="Срок" :late="!!t.due && t.due < today && t.status !== 'done'" @update:model-value="(d) => patch(t, { due: d || undefined })" />
        <input class="est tw:py-4 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px]" type="number" min="0" step="15" :value="t.estimateMin ?? ''" placeholder="мин" title="Оценка, минут" @change="patch(t, { estimateMin: Number(($event.target as HTMLInputElement).value) || undefined })" />
        <button v-if="t.from" class="from tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-6 tw:border-0 tw:bg-transparent tw:text-[11px] tw:text-warn tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="`Создана из заметки — открыть ${fmtDay(t.from.day)}`" @click="emit('openDay', t.from.day)"><Icon name="note" :size="12" />{{ fmtDay(t.from.day) }}</button>
        <span v-else></span>
        <button class="more tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[11px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="t.description ? 'Описание' : 'Добавить описание'" @click="open = open === t.id ? undefined : t.id"><Icon :name="open === t.id ? 'chevronDown' : 'chevronRight'" :size="13" /></button>
        <button class="del tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[11px] tw:hover:text-down-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Удалить" @click="remove(t)"><Icon name="trash" :size="13" /></button>
        <textarea v-if="open === t.id" class="desc tw:py-4 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px] tw:col-[2/-1] tw:resize-y" :value="t.description ?? ''" rows="3" placeholder="Описание" spellcheck="false" @change="patch(t, { description: ($event.target as HTMLTextAreaElement).value.trim() || undefined })"></textarea>
      </div>
    </template>
    <p v-if="!groups.length" class="muted small tw:text-[12px]">Задач нет. Добавьте строкой выше или кнопкой «В задачу» у любой заметки.</p>
  </section>
</template>

<style scoped src="./LocalTasks.css"></style>
