<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { fromExcel, isoIn, isoWeek, offsetIn, parseMoment, relative, sqlIn, toExcel, type TsUnit } from '@shared/timestamp'
import Icon from '../Icon.vue'

/**
 * Timestamp: one moment, every usual way of writing it — each row can be typed into (Unix seconds,
 * milliseconds, ISO with or without the zone, RFC 2822, SQL, Excel…) and the rest follow. A zone of one's
 * choice next to the local time and UTC.
 */
const KEY = 'qa.tools.ts'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { tz?: string; ms?: number }
  } catch {
    return {}
  }
})()
const ms = ref<number | undefined>(saved.ms ?? Date.now())
const tz = ref(saved.tz ?? 'UTC')
watch([ms, tz], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tz: tz.value, ms: ms.value }))
  } catch {
    // fine
  }
})
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const ZONES = (() => {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  const top = ['UTC', 'Europe/Moscow', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Novosibirsk', 'Asia/Yekaterinburg', 'Asia/Vladivostok']
  return [...new Set([...top, ...all])]
})()

// the clock: «Сейчас», going on
const live = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
watch(
  live,
  (on) => {
    clearInterval(timer)
    if (on) timer = setInterval(() => (ms.value = Date.now()), 250)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(timer))
const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 10_000)
onBeforeUnmount(() => clearInterval(tick))

// ---------- the main field: anything ----------
const input = ref('')
const inputErr = ref(false)
/** The unit of a bare number in the main field (auto — by its length). */
const unit = ref<TsUnit | 'auto'>('auto')
watch([input, unit], () => {
  if (!input.value.trim()) return void (inputErr.value = false)
  const v = parseMoment(input.value, unit.value === 'auto' ? undefined : unit.value)
  inputErr.value = v === undefined
  if (v !== undefined) {
    live.value = false
    ms.value = v
  }
})

// ---------- the rows: each one written and read its own way ----------
const fmtRu = (v: number, zone?: string) => new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: zone })
const ROWS: Array<{ id: string; label: string; hint?: string; fmt: (v: number) => string; parse?: (s: string) => number | undefined }> = [
  { id: 's', label: 'Unix, секунды', fmt: (v) => String(Math.floor(v / 1000)), parse: (s) => parseMoment(s, 's') },
  { id: 'ms', label: 'Unix, миллисекунды', hint: 'JavaScript Date.now(), Java System.currentTimeMillis()', fmt: (v) => String(v), parse: (s) => parseMoment(s, 'ms') },
  { id: 'us', label: 'Unix, микросекунды', hint: 'PostgreSQL, Python time_ns()/1000', fmt: (v) => `${v}000`, parse: (s) => parseMoment(s, 'us') },
  { id: 'ns', label: 'Unix, наносекунды', hint: 'Go UnixNano, Java Instant (нс)', fmt: (v) => `${v}000000`, parse: (s) => parseMoment(s, 'ns') },
  { id: 'isoz', label: 'ISO 8601, UTC', hint: 'JSON, toISOString()', fmt: (v) => new Date(v).toISOString(), parse: (s) => parseMoment(s) },
  { id: 'isol', label: 'ISO 8601, местное', hint: `со смещением ${LOCAL_TZ}`, fmt: (v) => isoIn(v), parse: (s) => parseMoment(s) },
  { id: 'rfc', label: 'RFC 2822 / HTTP', hint: 'заголовки Date, Last-Modified, Expires', fmt: (v) => new Date(v).toUTCString(), parse: (s) => parseMoment(s) },
  { id: 'sqll', label: 'SQL, местное', fmt: (v) => sqlIn(v), parse: (s) => parseMoment(s) },
  { id: 'sqlu', label: 'SQL, UTC', fmt: (v) => sqlIn(v, 'UTC'), parse: (s) => parseMoment(s.trim().replace(' ', 'T') + 'Z') },
  { id: 'ru', label: 'Как в России', fmt: (v) => fmtRu(v), parse: (s) => parseMoment(s.replace(',', '')) },
  { id: 'xl', label: 'Excel / 1С, число', hint: 'дни с 30.12.1899, время — дробная часть', fmt: (v) => String(toExcel(v)), parse: (s) => (/^\d+([.,]\d+)?$/.test(s.trim()) ? fromExcel(Number(s.trim().replace(',', '.'))) : undefined) },
]
const edits = reactive<Record<string, string>>({})
const bad = reactive<Record<string, boolean>>({})
function onRow(id: string, s: string): void {
  edits[id] = s
  const r = ROWS.find((x) => x.id === id)
  const v = r?.parse?.(s)
  bad[id] = v === undefined && !!s.trim()
  if (v !== undefined) {
    live.value = false
    ms.value = v
  }
}
function endRow(id: string): void {
  delete edits[id]
  delete bad[id]
}
const shownRow = (id: string) => (edits[id] !== undefined ? edits[id] : ms.value === undefined ? '' : ROWS.find((r) => r.id === id)!.fmt(ms.value))

// ---------- what the moment is ----------
const facts = computed(() => {
  const v = ms.value
  if (v === undefined) return []
  const d = new Date(v)
  const wk = isoWeek(v)
  const doy = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5)
  const off = offsetIn(v)
  return [
    { k: 'Относительно сейчас', v: relative(v, now.value) },
    { k: 'День недели', v: d.toLocaleDateString('ru-RU', { weekday: 'long' }) },
    { k: 'Неделя ISO', v: `${wk.week}-я, ${wk.year}` },
    { k: 'День года', v: `${doy}-й из ${new Date(d.getFullYear(), 1, 29).getDate() === 29 ? 366 : 365}` },
    { k: 'Квартал', v: `${Math.floor(d.getMonth() / 3) + 1}-й` },
    { k: 'Ваш часовой пояс', v: `${LOCAL_TZ}, UTC${off >= 0 ? '+' : '−'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? ':' + String(Math.abs(off) % 60).padStart(2, '0') : ''}` },
  ]
})
const inZone = computed(() => (ms.value === undefined ? '' : `${fmtRu(ms.value, tz.value)}  ·  ${isoIn(ms.value, tz.value)}`))
const copied = ref('')
async function copy(t: string): Promise<void> {
  await navigator.clipboard.writeText(t)
  copied.value = t
  setTimeout(() => copied.value === t && (copied.value = ''), 1200)
}
function setNow(): void {
  input.value = ''
  ms.value = Date.now()
}
</script>

<template>
  <div class="ts tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="top tw:flex-none tw:flex tw:items-center tw:gap-10 tw:py-12 tw:px-14 tw:border-b tw:border-b-border">
      <div class="main tw:flex-1 tw:min-w-0 tw:flex tw:items-center tw:gap-8 tw:h-40 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-12 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:text-muted tw:focus-within:not-[&.bad]:border-accent tw:[&.bad]:border-down" :class="{ bad: inputErr }">
        <Icon name="clock" :size="15" />
        <input class="tw:flex-1 tw:min-w-0 tw:h-38 tw:p-0 tw:border-0 tw:bg-transparent tw:text-text-hi tw:font-data tw:text-[14px] tw:outline-none" v-model="input" spellcheck="false" placeholder="Вставьте что угодно: 1792326600, 1792326600250, 2026-10-18T12:30:00Z, Sun, 18 Oct 2026 12:30:00 GMT, 18.10.2026 15:30" />
        <select class="tw:flex-none tw:h-30 tw:text-[12px]" v-model="unit" title="Единица голого числа">
          <option value="auto">число: авто</option>
          <option value="s">секунды</option>
          <option value="ms">миллисекунды</option>
          <option value="us">микросекунды</option>
          <option value="ns">наносекунды</option>
        </select>
      </div>
      <button class="btn tw:flex-none tw:inline-flex tw:items-center tw:gap-6 tw:h-32" title="Текущий момент" @click="setNow"><Icon name="refresh" :size="13" />Сейчас</button>
      <label class="chk tw:flex-none tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]" title="Часы идут — значения обновляются"><input v-model="live" type="checkbox" />Идут</label>
    </div>
    <p v-if="inputErr" class="hint err tw:flex-none tw:mt-8 tw:mr-16 tw:mb-0 tw:ml-16 tw:text-[12.5px] tw:text-down-fg">Не понимаю этот формат. Подойдут числа (секунды, мс, мкс, нс), ISO 8601, RFC 2822, «2026-10-18 15:30», «18.10.2026 15:30».</p>
    <div class="body tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]">
      <div class="rows tw:flex tw:flex-col tw:gap-4 tw:min-w-0 tw:py-12 tw:px-14 tw:overflow-auto">
        <div v-for="r in ROWS" :key="r.id" class="row tw:group/row tw:grid tw:grid-cols-[190px_minmax(0,1fr)_30px] tw:items-center tw:gap-10" :class="{ bad: bad[r.id] }">
          <span class="lb tw:flex tw:flex-col tw:min-w-0 tw:text-text-2 tw:text-[12.5px]" :title="r.hint">{{ r.label }}<em class="tw:overflow-hidden tw:text-dim tw:text-[11px] tw:not-italic tw:text-ellipsis tw:whitespace-nowrap" v-if="r.hint">{{ r.hint }}</em></span>
          <input class="tw:h-32 tw:font-data tw:text-[13px] tw:group-[.bad]/row:border-down" :value="shownRow(r.id)" spellcheck="false" @input="onRow(r.id, ($event.target as HTMLInputElement).value)" @blur="endRow(r.id)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
          <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:border-border-3" :title="copied && copied === shownRow(r.id) ? 'Скопировано' : 'Копировать'" :disabled="!shownRow(r.id)" @click="copy(shownRow(r.id))"><Icon :name="copied && copied === shownRow(r.id) ? 'check' : 'copy'" :size="13" /></button>
        </div>
        <div class="row zone tw:grid tw:grid-cols-[190px_minmax(0,1fr)_30px] tw:items-center tw:gap-10 tw:mt-8 tw:pt-10 tw:border-t tw:border-t-border">
          <span class="lb tw:flex tw:flex-col tw:min-w-0 tw:text-text-2 tw:text-[12.5px]">В часовом поясе</span>
          <div class="zv tw:flex tw:items-center tw:gap-10 tw:min-w-0">
            <select class="tw:flex-none tw:max-w-200 tw:h-32" v-model="tz">
              <option v-for="z in ZONES" :key="z" :value="z">{{ z }}</option>
            </select>
            <code class="tw:overflow-hidden tw:text-text tw:font-data tw:text-[12.5px] tw:text-ellipsis tw:whitespace-nowrap">{{ inZone }}</code>
          </div>
          <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:border-border-3" title="Копировать ISO в этом поясе" :disabled="ms === undefined" @click="ms !== undefined && copy(isoIn(ms, tz))"><Icon name="copy" :size="13" /></button>
        </div>
      </div>
      <aside class="facts tw:flex tw:flex-col tw:gap-10 tw:min-w-0 tw:p-14 tw:overflow-auto tw:border-l tw:border-l-border">
        <div v-for="f in facts" :key="f.k" class="fact tw:flex tw:flex-col tw:gap-2 tw:text-[12px]"><span class="tw:text-muted">{{ f.k }}</span><b class="tw:text-text-hi tw:text-[13.5px] tw:font-medium tw:first-letter:uppercase">{{ f.v }}</b></div>
        <p class="note tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-dim tw:text-[11.5px]">Любую строку слева можно править — остальные пересчитаются. Число без единицы распознаётся по длине: 10 цифр — секунды, 13 — мс, 16 — мкс, 19 — нс.</p>
      </aside>
    </div>
  </div>
</template>
