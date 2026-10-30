<script setup lang="ts">
/**
 * Schedules of notes: a new one for this note (a cron expression — in words and its next runs as it is typed; ready
 * ones in a menu) and the list — this note's or all of them — each with its last run (done, failed, missed — the app
 * was closed), on / off, run now, its journal, deleted (asked again first).
 */
import { computed, ref } from 'vue'
import { CRON_PRESETS } from '@shared/cron'
import { cronCheck, jobTitle, nextDue, type CronJob, type CronRun } from '@shared/cronJobs'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import MenuButton, { type MenuItem } from '@renderer/components/MenuButton.vue'
import { useCronJobs } from '@nb/workspace/cronStore'
import { openNoteAt } from '@nb/workspace/noteGoto'

/** `note` — the note a new one is for; `all` — every note's schedules listed (else this note's). */
const props = defineProps<{ note: string; all?: boolean }>()
const jobs = useCronJobs()
const shown = computed(() => (props.all ? jobs.value : jobs.value.filter((j) => j.note === props.note)))

// ---------- a new one ----------
const expr = ref('0 9 * * 1-5')
const title = ref('')
const said = ref('')
const check = computed(() => cronCheck(expr.value))
const presets = computed<MenuItem[]>(() => CRON_PRESETS.map((p) => ({ label: `${p.title} · ${p.expr}`, run: () => (expr.value = p.expr) })))
async function add(): Promise<void> {
  said.value = ''
  try {
    await window.qa.cronSave({ note: props.note, expr: expr.value, title: title.value, on: true })
    title.value = ''
  } catch (e) {
    said.value = remoteError(e)
  }
}

// ---------- the list ----------
const STATE: Record<CronRun['state'], { word: string; cls: string }> = {
  ok: { word: 'выполнен', cls: 'tw:text-up-fg' },
  error: { word: 'ошибка', cls: 'tw:text-down-fg' },
  missed: { word: 'пропущен', cls: 'tw:text-warn-fg' },
}
const when = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const runText = (r: CronRun) => `${when(r.at)} · ${STATE[r.state].word}${r.count && r.count > 1 ? ` ×${r.count}` : ''}${r.hand ? ' (вручную)' : ''}${r.ms !== undefined ? ` · ${Math.round(r.ms / 1000)} с` : ''}`
const words = (j: CronJob) => {
  const c = cronCheck(j.expr, 1)
  return c.ok ? c.words : ''
}
/** The jobs whose journal is shown; the one asked to be deleted (a second click deletes); the ones running now. */
const opened = ref(new Set<string>())
const toDelete = ref('')
const running = ref(new Set<string>())
const toggleJournal = (id: string) => (opened.value = new Set(opened.value.has(id) ? [...opened.value].filter((x) => x !== id) : [...opened.value, id]))
async function act(job: CronJob, what: () => Promise<unknown>): Promise<void> {
  said.value = ''
  try {
    await what()
  } catch (e) {
    said.value = `«${jobTitle(job)}»: ${remoteError(e)}`
  }
}
const toggleOn = (job: CronJob) => act(job, () => window.qa.cronSave({ id: job.id, on: !job.on }))
function remove(job: CronJob): void {
  if (toDelete.value !== job.id) {
    toDelete.value = job.id
    setTimeout(() => toDelete.value === job.id && (toDelete.value = ''), 3000)
    return
  }
  toDelete.value = ''
  void act(job, () => window.qa.cronRemove(job.id))
}
async function runNow(job: CronJob): Promise<void> {
  running.value = new Set([...running.value, job.id])
  await act(job, () => window.qa.cronRunNow(job.id))
  running.value = new Set([...running.value].filter((x) => x !== job.id))
}
const iconBtn = 'tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-40'
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-8 tw:min-w-0 tw:text-[12.5px]">
    <!-- a new one for this note -->
    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-6">
      <input v-model="expr" class="tw:w-150 tw:h-26 tw:py-0 tw:px-8 tw:font-data tw:text-[12px]" spellcheck="false" placeholder="0 9 * * 1-5" title="Cron: мин час день месяц день_недели (или 6 полей с секундами первыми)" @keydown.enter.prevent="check.ok && add()" />
      <MenuButton icon="list" title="Готовые расписания" :width="300" :items="presets" />
      <input v-model="title" class="tw:flex-1 tw:min-w-120 tw:h-26 tw:py-0 tw:px-8" maxlength="120" placeholder="Название (необязательно)" @keydown.enter.prevent="check.ok && add()" />
      <button class="primary tw:h-26 tw:py-0 tw:px-12" :disabled="!check.ok" @click="add">Добавить</button>
    </div>
    <p class="tw:m-0 tw:min-w-0 tw:truncate tw:text-[11.5px]" :class="check.ok ? 'tw:text-muted' : 'tw:text-down-fg'" :title="check.ok ? check.next.map((d) => when(d.getTime())).join('\n') : check.error">
      {{ check.ok ? `${check.words} · ближайшие: ${check.next.map((d) => when(d.getTime())).join(', ')}` : check.error }}
    </p>
    <p v-if="said" class="tw:m-0 tw:text-down-fg tw:text-[11.5px]">{{ said }}</p>

    <!-- the list -->
    <p v-if="!shown.length" class="tw:m-0 tw:text-muted tw:text-[12px]">{{ all ? 'Расписаний пока нет' : 'У этого документа расписаний нет' }}</p>
    <div v-for="j in shown" :key="j.id" class="tw:flex tw:flex-col tw:gap-2 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-[6px] tw:bg-bg" :class="{ 'tw:opacity-60': !j.on }">
      <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0">
        <input type="checkbox" class="tw:flex-none" :checked="j.on" :title="j.on ? 'Включено — выключить' : 'Выключено — включить'" @change="toggleOn(j)" />
        <b class="tw:flex-none tw:max-w-[40%] tw:truncate tw:font-semibold" :title="jobTitle(j)">{{ jobTitle(j) }}</b>
        <button v-if="all" class="tw:min-w-0 tw:truncate tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[11.5px] tw:hover:underline" :title="`Открыть ${j.note}`" @click="openNoteAt(j.note)">{{ j.note }}</button>
        <span class="tw:flex-1"></span>
        <span v-if="j.runs[0]" class="tw:flex-none tw:font-data tw:text-[11px]" :class="STATE[j.runs[0].state].cls" :title="j.runs[0].error ?? ''">{{ runText(j.runs[0]) }}</span>
        <span v-else class="tw:flex-none tw:text-muted tw:text-[11px]">ещё не запускалось</span>
        <button :class="iconBtn" :disabled="running.has(j.id)" :title="running.has(j.id) ? 'Выполняется…' : 'Выполнить сейчас (как по расписанию)'" @click="runNow(j)"><Icon :name="running.has(j.id) ? 'timer' : 'play'" :size="12" /></button>
        <button :class="iconBtn" :title="opened.has(j.id) ? 'Скрыть журнал' : 'Журнал запусков'" @click="toggleJournal(j.id)"><Icon name="chevronRight" :size="12" :style="opened.has(j.id) ? 'transform: rotate(90deg)' : ''" /></button>
        <button :class="[iconBtn, { 'tw:text-down-fg': toDelete === j.id }]" :title="toDelete === j.id ? 'Нажмите ещё раз — удалить' : 'Удалить расписание'" @click="remove(j)"><Icon :name="toDelete === j.id ? 'trash' : 'x'" :size="12" /></button>
      </div>
      <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:pl-20 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap">
        <code class="tw:flex-none tw:font-data">{{ j.expr }}</code>
        <span class="tw:min-w-0 tw:truncate">{{ words(j) }}</span>
        <span class="tw:flex-1"></span>
        <span v-if="nextDue(j)" class="tw:flex-none">следующий {{ when(nextDue(j)!) }}</span>
      </div>
      <div v-if="opened.has(j.id)" class="tw:flex tw:flex-col tw:gap-2 tw:pl-20 tw:font-data tw:text-[11px]">
        <span v-if="!j.runs.length" class="tw:text-muted">Запусков ещё не было</span>
        <span v-for="(r, i) in j.runs" :key="i" class="tw:min-w-0 tw:truncate" :class="STATE[r.state].cls" :title="r.error ?? ''">{{ runText(r) }}{{ r.error ? ` — ${r.error}` : '' }}</span>
      </div>
    </div>
  </div>
</template>
