<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { convertCron, CRON_DIALECTS, CRON_FORMATS, CRON_PRESETS, describeCron, fitsFormat, fromCrontab, guessFormat, nextRuns, type CronFormat } from '@shared/cron'
import CronBuilder from './CronBuilder.vue'
import Icon from '../Icon.vue'

/**
 * Cron: an expression ↔ its meaning. Typed or pasted — it is read into words (cronstrue) and its next runs
 * (cron-parser); or it is made by choosing in a sentence («Каждую неделю по пн-сб в 12 : 00») —
 * @vue-js-cron/core. Unix / Spring / Quartz; a pasted expression switches to its dialect.
 */
const KEY = 'qa.tools.cron'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { expr?: string; format?: CronFormat }
  } catch {
    return {}
  }
})()
const format = ref<CronFormat>(saved.format && Object.hasOwn(CRON_DIALECTS, saved.format) ? saved.format : 'crontab')
const dialect = computed(() => CRON_DIALECTS[format.value])
const expr = ref(saved.expr ?? '0 12 * * 1-6')
watch([expr, format], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ expr: expr.value, format: format.value }))
  } catch {
    // fine
  }
})
/** Another dialect picked: the expression goes along. */
function setFormat(f: CronFormat): void {
  if (f === format.value) return
  try {
    expr.value = convertCron(expr.value, format.value, f)
  } catch {
    // a broken one stays as it is
  }
  format.value = f
}
/** A pasted / typed expression in another dialect (by its number of fields): switched to it. */
function onInput(v: string): void {
  expr.value = v
  const g = guessFormat(v)
  if (g && !fitsFormat(v.trim().split(/\s+/).length, format.value)) format.value = g
}
const result = computed(() => {
  const e = expr.value.trim()
  if (!e) return { text: '', error: '' }
  try {
    return { text: describeCron(e, format.value), error: '' }
  } catch (err) {
    return { text: '', error: cleanErr(err) }
  }
})
const cleanErr = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, '')
// the next runs move with the clock
const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(tick))
const utc = ref(false)
const runs = computed<{ list: Date[]; error: string }>(() => {
  if (!expr.value.trim() || result.value.error) return { list: [], error: '' }
  try {
    return { list: nextRuns(expr.value, format.value, 12, new Date(now.value), utc.value ? 'UTC' : undefined), error: '' }
  } catch (err) {
    return { list: [], error: cleanErr(err) }
  }
})
const fmtRun = (d: Date) =>
  d.toLocaleString('ru-RU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: dialect.value.seconds ? '2-digit' : undefined, timeZone: utc.value ? 'UTC' : undefined })
function rel(d: Date): string {
  let s = Math.round((d.getTime() - now.value) / 1000)
  if (s < 60) return 'меньше минуты'
  const parts: string[] = []
  const dd = Math.floor(s / 86400)
  s -= dd * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  if (dd) parts.push(`${dd} д`)
  if (h && dd < 30) parts.push(`${h} ч`)
  if (m && !dd) parts.push(`${m} мин`)
  return `через ${parts.join(' ')}`
}
const presets = computed(() => CRON_PRESETS.map((p) => ({ ...p, expr: fromCrontab(p.expr, format.value) })))
const copied = ref(false)
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(expr.value.trim())
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
/** The fields of the dialect (what each place of the expression is). */
const FIELDS = computed(() => dialect.value.fields)
</script>

<template>
  <div class="cr tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="bar tw:flex-none tw:flex tw:items-center tw:gap-14 tw:h-44 tw:py-0 tw:px-14 tw:border-b tw:border-b-border tw:whitespace-nowrap tw:overflow-hidden">
      <span class="seg tw:flex-none tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
        <button class="tw:h-28 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:font-data tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" v-for="f in CRON_FORMATS" :key="f.id" :class="{ on: format === f.id }" :title="f.hint" @click="setFormat(f.id)">{{ f.title }}</button>
      </span>
      <span class="muted tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[12px]">{{ dialect.hint }}</span>
    </div>
    <div class="body tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
      <div class="main tw:flex tw:flex-col tw:gap-14 tw:min-w-0 tw:py-16 tw:px-18 tw:overflow-auto">
        <div class="exprw tw:flex tw:items-center tw:gap-6">
          <input class="expr tw:flex-1 tw:min-w-0 tw:h-44 tw:py-0 tw:px-14 tw:font-data tw:text-[20px] tw:tracking-[0.04em]" :value="expr" spellcheck="false" :placeholder="dialect.placeholder" @input="onInput(($event.target as HTMLInputElement).value)" />
          <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:border-border-3" :title="copied ? 'Скопировано' : 'Копировать выражение'" :disabled="!expr.trim()" @click="copy"><Icon :name="copied ? 'check' : 'copy'" :size="14" /></button>
        </div>
        <div class="fields tw:grid tw:gap-6 tw:-mt-6" :style="{ gridTemplateColumns: `repeat(${FIELDS.length}, minmax(0, 1fr))` }">
          <span class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:overflow-hidden tw:text-muted tw:text-[11px] tw:whitespace-nowrap" v-for="(f, i) in FIELDS" :key="f.name" :title="f.values"><code class="tw:max-w-full tw:overflow-hidden tw:text-accent-fg tw:font-data tw:text-[12.5px] tw:text-ellipsis">{{ expr.trim().split(/\s+/)[i] ?? '' }}</code>{{ f.name }}</span>
        </div>
        <p v-if="result.error" class="desc err tw:m-0 tw:text-down-fg tw:text-[13px] tw:font-medium tw:first-letter:uppercase">{{ result.error }}</p>
        <p v-else-if="result.text" class="desc tw:m-0 tw:text-text-hi tw:text-[16px] tw:font-semibold tw:first-letter:uppercase">{{ result.text }}</p>

        <div class="card tw:flex tw:flex-col tw:gap-10 tw:py-12 tw:px-14 tw:border tw:border-border tw:rounded-r2 tw:bg-panel">
          <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Конструктор</div>
          <CronBuilder :key="format" :model-value="expr" :format="format" @update:model-value="(v) => (expr = v)" />
        </div>

        <div class="card tw:flex tw:flex-col tw:gap-10 tw:py-12 tw:px-14 tw:border tw:border-border tw:rounded-r2 tw:bg-panel">
          <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Готовые</div>
          <div class="pre tw:flex tw:flex-wrap tw:gap-6">
            <button class="tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:not-[&.on]:text-text tw:hover:bg-hover tw:[&.on]:border-accent/60 tw:[&.on]:text-accent-fg" v-for="p in presets" :key="p.title" :class="{ on: p.expr === expr.trim() }" :title="p.expr" @click="expr = p.expr">{{ p.title }}</button>
          </div>
        </div>
      </div>

      <aside class="runs tw:flex tw:flex-col tw:gap-4 tw:min-w-0 tw:p-14 tw:overflow-auto tw:border-l tw:border-l-border">
        <div class="ph tw:flex tw:items-center tw:gap-8 tw:min-h-28 tw:mb-4 tw:text-[12.5px]">
          <b class="tw:text-text-hi">Ближайшие запуски</b>
          <span class="grow tw:flex-1"></span>
          <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12px]" title="Время по UTC (как на сервере без часового пояса)"><input v-model="utc" type="checkbox" />UTC</label>
        </div>
        <p v-if="runs.error" class="err tw:text-down-fg tw:text-[13px] tw:font-medium">{{ runs.error }}</p>
        <div v-for="(d, i) in runs.list" :key="i" class="run tw:flex tw:justify-between tw:gap-10 tw:py-6 tw:px-8 tw:rounded-r2 tw:font-data tw:text-[12px] tw:whitespace-nowrap tw:[&.first]:bg-accent/10 tw:[&.first]:text-text-hi" :class="{ first: i === 0 }">
          <span>{{ fmtRun(d) }}</span>
          <em class="tw:overflow-hidden tw:text-muted tw:not-italic tw:text-ellipsis">{{ rel(d) }}</em>
        </div>
        <p v-if="!runs.list.length && !runs.error && !result.error && expr.trim()" class="muted tw:text-muted tw:text-[12px]">Запусков впереди нет</p>
        <div class="ref tw:flex tw:flex-col tw:gap-4 tw:mt-14 tw:pt-12 tw:border-t tw:border-t-border tw:text-text-2 tw:text-[12px]">
          <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Символы</div>
          <div><code class="tw:inline-block tw:w-26 tw:text-accent-fg tw:font-data">*</code>любое значение</div>
          <div><code class="tw:inline-block tw:w-26 tw:text-accent-fg tw:font-data">,</code>список: 1,15</div>
          <div><code class="tw:inline-block tw:w-26 tw:text-accent-fg tw:font-data">-</code>диапазон: 1-5</div>
          <div><code class="tw:inline-block tw:w-26 tw:text-accent-fg tw:font-data">/</code>шаг: */10 — каждые 10</div>
          <div><code class="tw:inline-block tw:w-26 tw:text-accent-fg tw:font-data">L</code>последний (день месяца / недели)</div>
          <div><code class="tw:inline-block tw:w-26 tw:text-accent-fg tw:font-data">#</code>N-й день недели: 1#2 — второй понедельник</div>
          <div v-if="dialect.noSpecificDay"><code class="tw:inline-block tw:w-26 tw:text-accent-fg tw:font-data">?</code>не важно (день месяца или недели)</div>
        </div>
      </aside>
    </div>
  </div>
</template>
