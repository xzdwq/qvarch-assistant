<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { convertCron, CRON_FORMATS, CRON_PRESETS, describeCron, fromCrontab, guessFormat, nextRuns, type CronFormat } from '@shared/cron'
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
const format = ref<CronFormat>(saved.format ?? 'crontab')
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
  const n = v.trim().split(/\s+/).length
  const fits = format.value === 'crontab' ? n === 5 : format.value === 'spring' ? n === 6 : n === 6 || n === 7
  if (g && !fits) format.value = g
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
  d.toLocaleString('ru-RU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: format.value === 'crontab' ? undefined : '2-digit', timeZone: utc.value ? 'UTC' : undefined })
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
const FIELDS = computed(() => {
  const base = [
    { n: 'минута', v: '0–59' },
    { n: 'час', v: '0–23' },
    { n: 'день месяца', v: format.value === 'crontab' ? '1–31, L' : '1–31, L, W, ?' },
    { n: 'месяц', v: '1–12, JAN–DEC' },
    { n: 'день недели', v: format.value === 'quartz' ? '1–7 (1 = вс), SUN–SAT, ?, L, #' : '0–7 (0, 7 = вс), SUN–SAT, L, #' },
  ]
  return format.value === 'crontab' ? base : [{ n: 'секунда', v: '0–59' }, ...base, ...(format.value === 'quartz' ? [{ n: 'год (необяз.)', v: '1970–2099' }] : [])]
})
</script>

<template>
  <div class="cr">
    <div class="bar">
      <span class="seg">
        <button v-for="f in CRON_FORMATS" :key="f.id" :class="{ on: format === f.id }" :title="f.hint" @click="setFormat(f.id)">{{ f.title }}</button>
      </span>
      <span class="muted">{{ CRON_FORMATS.find((f) => f.id === format)!.hint }}</span>
    </div>
    <div class="body">
      <div class="main">
        <div class="exprw">
          <input class="expr" :value="expr" spellcheck="false" :placeholder="format === 'crontab' ? '0 12 * * 1-6' : '0 0 12 * * 1-6'" @input="onInput(($event.target as HTMLInputElement).value)" />
          <button class="ib" :title="copied ? 'Скопировано' : 'Копировать выражение'" :disabled="!expr.trim()" @click="copy"><Icon :name="copied ? 'check' : 'copy'" :size="14" /></button>
        </div>
        <div class="fields" :style="{ gridTemplateColumns: `repeat(${FIELDS.length}, minmax(0, 1fr))` }">
          <span v-for="(f, i) in FIELDS" :key="f.n" :title="f.v"><code>{{ expr.trim().split(/\s+/)[i] ?? '' }}</code>{{ f.n }}</span>
        </div>
        <p v-if="result.error" class="desc err">{{ result.error }}</p>
        <p v-else-if="result.text" class="desc">{{ result.text }}</p>

        <div class="card">
          <div class="cap">Конструктор</div>
          <CronBuilder :key="format" :model-value="expr" :format="format" @update:model-value="(v) => (expr = v)" />
        </div>

        <div class="card">
          <div class="cap">Готовые</div>
          <div class="pre">
            <button v-for="p in presets" :key="p.title" :class="{ on: p.expr === expr.trim() }" :title="p.expr" @click="expr = p.expr">{{ p.title }}</button>
          </div>
        </div>
      </div>

      <aside class="runs">
        <div class="ph">
          <b>Ближайшие запуски</b>
          <span class="grow"></span>
          <label class="chk" title="Время по UTC (как на сервере без часового пояса)"><input v-model="utc" type="checkbox" />UTC</label>
        </div>
        <p v-if="runs.error" class="err">{{ runs.error }}</p>
        <div v-for="(d, i) in runs.list" :key="i" class="run" :class="{ first: i === 0 }">
          <span>{{ fmtRun(d) }}</span>
          <em>{{ rel(d) }}</em>
        </div>
        <p v-if="!runs.list.length && !runs.error && !result.error && expr.trim()" class="muted">Запусков впереди нет</p>
        <div class="ref">
          <div class="cap">Символы</div>
          <div><code>*</code>любое значение</div>
          <div><code>,</code>список: 1,15</div>
          <div><code>-</code>диапазон: 1-5</div>
          <div><code>/</code>шаг: */10 — каждые 10</div>
          <div><code>L</code>последний (день месяца / недели)</div>
          <div><code>#</code>N-й день недели: 1#2 — второй понедельник</div>
          <div v-if="format !== 'crontab'"><code>?</code>не важно (день месяца или недели)</div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.cr {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
}
.bar .muted {
  overflow: hidden;
  text-overflow: ellipsis;
}
.seg {
  flex: none;
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg button {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 12px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
}
.main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 16px 18px;
  overflow: auto;
}
.exprw {
  display: flex;
  align-items: center;
  gap: 6px;
}
.expr {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 14px;
  font-family: var(--font-data);
  font-size: 20px;
  letter-spacing: 0.04em;
}
.fields {
  display: grid;
  gap: 6px;
  margin-top: -6px;
}
.fields span {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.fields code {
  max-width: 100%;
  overflow: hidden;
  color: var(--accent-fg);
  font-family: var(--font-data);
  font-size: 12.5px;
  text-overflow: ellipsis;
}
.desc {
  margin: 0;
  color: var(--text-hi);
  font-size: 16px;
  font-weight: 600;
}
.desc::first-letter {
  text-transform: uppercase;
}
.err {
  color: var(--down-fg);
  font-size: 13px;
  font-weight: 500;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--panel);
}
.cap {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.pre {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pre button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.pre button:hover {
  color: var(--text);
  background: var(--hover);
}
.pre button.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  color: var(--accent-fg);
}
.runs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 14px;
  overflow: auto;
  border-left: 1px solid var(--border);
}
.ph {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  margin-bottom: 4px;
  font-size: 12.5px;
}
.ph b {
  color: var(--text-hi);
}
.grow {
  flex: 1;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 12px;
}
.run {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--r2);
  font-family: var(--font-data);
  font-size: 12px;
  white-space: nowrap;
}
.run em {
  overflow: hidden;
  color: var(--muted);
  font-style: normal;
  text-overflow: ellipsis;
}
.run.first {
  background: rgb(var(--accent-rgb) / 0.1);
  color: var(--text-hi);
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ref {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--text-2);
  font-size: 12px;
}
.ref code {
  display: inline-block;
  width: 26px;
  color: var(--accent-fg);
  font-family: var(--font-data);
}
</style>
