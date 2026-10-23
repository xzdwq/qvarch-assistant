<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { bodyVars, findLoops, LOOP_CLOSE_MD, LOOP_MAX, LOOP_PARALLEL_LIMIT, loopKey, loopOpenMd, loopStartAt, type LoopInfo } from '@shared/loop'
import { summary } from '@shared/runbook'
import { envAt, loopHasPw, noteRun, pickPass, pretty, runLoop, stopLoop, type BlockRun } from '../../lib/runbook'
import { doc } from '../../lib/notebook'
import { useFold } from '../../lib/foldState'
import { asGrid, useGrid } from '../../lib/grid'
import { passTitle } from '../../lib/loopView'
import { LOOP_PRESETS, type LoopPreset } from '@shared/loopPresets'
import type { MenuItem } from '../MenuButton.vue'
import CodeArea from '../CodeArea.vue'
import DataGrid from '../DataGrid.vue'
import Icon from '../Icon.vue'
import MenuButton from '../MenuButton.vue'
import RunHead from './RunHead.vue'

/**
 * A loop's start: its head — plain JS / TS that calls `body({ … })` for each pass (the blocks down to the loop's end
 * run with those names) — its settings (passes at once, passes at most), ▶ / ■, how its passes went.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parsed = computed(() => loopStartAt(props.src.split('\n'), 0) ?? { line1: 1, info: { parallel: 1, max: LOOP_MAX, timeout: 600 } as LoopInfo, head: '', ts: false })
const info = computed(() => parsed.value.info)
const head = ref(parsed.value.head)
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    head.value = loopStartAt(s.split('\n'), 0)?.head ?? ''
  },
)
const fence = computed(() => /^(`{3,}|~{3,})/.exec(props.src.split('\n')[1] ?? '')?.[1] ?? '```')
let timer: ReturnType<typeof setTimeout> | undefined
function write(i: LoopInfo = info.value, ts = parsed.value.ts, now = false): void {
  clearTimeout(timer)
  const go = () => {
    const src = `${loopOpenMd(i)}\n${fence.value}${ts ? 'ts' : 'js'} loop\n${head.value}\n${fence.value}`
    if (src === mine) return
    mine = src
    props.onChange?.(src)
  }
  if (now) go()
  else timer = setTimeout(go, 300)
}
watch(head, () => write())
const set = (patch: Partial<LoopInfo>) => write({ ...info.value, ...patch }, parsed.value.ts, true)
const num = (v: string, lo: number, hi: number, def: number) => Math.min(hi, Math.max(lo, Math.floor(Number(v)) || def))

const key = computed(() => loopKey(info.value.name, props.line))
const range = computed(() => findLoops(doc(props.path).text.split('\n')).find((l) => l.line0 === props.line))
const closed = computed(() => range.value?.end !== undefined)
const lr = computed(() => noteRun(props.path).loops[key.value])
const asRun = computed(() => lr.value as unknown as BlockRun | undefined)
const vars = computed(() => bodyVars(head.value))
const hasPw = computed(() => !!range.value && loopHasPw(doc(props.path).text, range.value))
async function go(): Promise<void> {
  write(undefined, undefined, true)
  const text = doc(props.path).text
  const r = findLoops(text.split('\n')).find((l) => l.line0 === props.line)
  if (!r || r.end === undefined) return
  await runLoop(props.path, r, text, envAt(props.path, props.line, text))
}
function stop(): void {
  stopLoop(props.path, key.value, envAt(props.path, props.line, doc(props.path).text).id)
}
/** No end yet: one put right under the head (the loop's blocks — between them). */
const close = () => props.onChange?.(`${mine}\n\n${LOOP_CLOSE_MD}`)

// ---------- how the passes went ----------
const passes = computed(() => lr.value?.passes ?? [])
const bad = computed(() => passes.value.filter((p) => p.state === 'error').length)
const running = computed(() => passes.value.filter((p) => p.state === 'run').length)
const showPasses = useFold(() => `${props.path}#${key.value}#passes`, false)
const table = computed(() =>
  showPasses.value && passes.value.length
    ? asGrid(
        passes.value.map((p) => ({
          '№': p.n,
          ...Object.fromEntries(Object.entries(p.vars).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])),
          состояние: p.state === 'ok' ? 'готово' : p.state === 'run' ? 'выполняется' : 'ошибка',
          мс: p.ms === undefined ? null : Math.round(p.ms),
          ошибка: p.error ?? null,
        })),
      )
    : undefined,
)
const grid = useGrid(table, () => info.value.name ?? 'Проходы')
const cur = computed(() => lr.value?.sel ?? passes.value.length - 1)
const go1 = (d: number) => pickPass(props.path, key.value, Math.min(passes.value.length - 1, Math.max(0, cur.value + d)))
const report = () => {
  const l = lr.value
  if (!l) return ''
  const t = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`)
  return [`${l.state === 'ok' ? '✅' : l.state === 'run' ? '⏳' : '❌'} Цикл «${info.value.name ?? key.value}» — проходов ${passes.value.length}${bad.value ? `, с ошибкой ${bad.value}` : ''}${l.ms !== undefined ? ` за ${t(l.ms)}` : ''}`, ...(l.error ? [`Ошибка: ${l.error}`] : []), ...passes.value.filter((p) => p.error).slice(0, 20).map((p) => `  ❌ ${passTitle(p)}: ${p.error}`)].join('\n')
}
const showValue = useFold(() => `${props.path}#${key.value}#result`, true)

// ---------- the presets: the head filled with a kind of loop over the note's own values ----------
/** The note's last list and last object (what a loop most likely goes over) — or names to change. */
const names = computed(() => {
  const ctx = noteRun(props.path).ctx
  const by = (ok: (v: unknown) => boolean) =>
    Object.keys(ctx)
      .filter((k) => ok(ctx[k].value))
      .sort((a, b) => ctx[b].at - ctx[a].at)[0]
  return { list: by(Array.isArray) ?? 'items', obj: by((v) => v !== null && typeof v === 'object' && !Array.isArray(v)) ?? 'obj' }
})
function usePreset(p: LoopPreset): void {
  head.value = p.code(names.value.list, names.value.obj)
  write({ ...info.value, parallel: p.parallel ?? (info.value.parallel > 1 ? info.value.parallel : 1) }, parsed.value.ts, true)
}
const presetItems = computed<MenuItem[]>(() => LOOP_PRESETS.map((p) => ({ label: p.title, title: `${p.hint}\n\n${p.code(names.value.list, names.value.obj)}`, run: () => usePreset(p) })))
</script>

<template>
  <div class="bl" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="report" icon="repeat" kind="Цикл" :name="info.name" :run="asRun" :can-run="closed" name-placeholder="проходы" @rename="(name) => set({ name })" @run="go" @stop="stop">
      <span class="seg">
        <button :class="{ on: !parsed.ts }" @mousedown.prevent @click="write(info, false, true)">JS</button>
        <button :class="{ on: parsed.ts }" title="TypeScript: типы просто убираются перед выполнением" @mousedown.prevent @click="write(info, true, true)">TS</button>
      </span>
      <label class="nm" :title="hasPw ? 'В цикле есть сценарий Playwright — проходы идут по одному' : `Сколько проходов одновременно (до ${LOOP_PARALLEL_LIMIT}). Работает, когда заголовок не ждёт каждый проход: await Promise.all(items.map((x) => body({ x })))`"
        >параллельно<input type="number" min="1" :max="LOOP_PARALLEL_LIMIT" :value="info.parallel" :disabled="hasPw" @change="set({ parallel: num(($event.target as HTMLInputElement).value, 1, LOOP_PARALLEL_LIMIT, 1) })"
      /></label>
      <label class="nm" title="Больше проходов — цикл останавливается: защита от бесконечного while"
        >макс.<input type="number" min="1" :value="info.max" @change="set({ max: num(($event.target as HTMLInputElement).value, 1, 100000, LOOP_MAX) })"
      /></label>
      <MenuButton icon="list" title="Заполнить заголовок готовым видом цикла: for…of, счётчик, for…in, Object.entries, while, параллельно…" :width="280" :items="presetItems" />
    </RunHead>
    <div v-if="!head.trim()" class="bl-pre">
      <p class="muted">Выберите вид цикла — код заполнится (по {{ names.list }} / {{ names.obj }} — имена можно поменять):</p>
      <div class="bl-pg">
        <button v-for="p in LOOP_PRESETS" :key="p.id" :title="p.code(names.list, names.obj)" @mousedown.prevent @click="usePreset(p)">
          <b>{{ p.title }}</b><span>{{ p.hint }}</span>
        </button>
      </div>
    </div>
    <div class="bl-ed"><CodeArea v-model="head" :lang="parsed.ts ? 'typescript' : 'js'" :run="go" :min-height="24" placeholder="for (const [i, item] of items.entries()) await body({ i, item })" /></div>
    <p class="bl-hint" title="Заголовок — обычный JS: for…of, for…in, Object.entries, while, условия, try/catch, break.&#10;await body({ … }) — проход за проходом; await Promise.all(xs.map((x) => body({ x }))) — параллельно.&#10;body() возвращает то, что опубликовали блоки прохода: const r = await body({ page }); if (!r.list.body.next) break&#10;Внутри цикла: loop.n — номер прохода (с 1), loop.index — с 0.">
      <code>body({ … })</code> — проход: блоки до конца цикла получают эти имена<template v-if="vars.length">: <code v-for="v in vars" :key="v">{{ v }}</code></template>, и <code>loop.n</code>
    </p>
    <p v-if="!closed" class="bl-er">Нет конца цикла.<button class="lnk" @mousedown.prevent @click="close">Добавить конец</button></p>
    <div v-if="lr" class="bl-out">
      <div class="bl-st">
        <button class="fold" :title="showPasses ? 'Скрыть проходы' : 'Показать проходы таблицей'" @mousedown.prevent @click="showPasses = !showPasses"><Icon name="chevronRight" :size="12" :style="showPasses ? 'transform: rotate(90deg)' : ''" /></button>
        <b>Проходов {{ passes.length }}</b>
        <span v-if="running" class="muted">· выполняется {{ running }}</span>
        <span v-if="bad" class="bad">· с ошибкой {{ bad }}</span>
        <span v-if="lr.trimmed" class="muted" title="Результаты старых проходов не сохранены — их значения остались">· старых без подробностей {{ lr.trimmed }}</span>
        <span class="grow"></span>
        <template v-if="passes.length > 1">
          <button class="ib" :disabled="cur <= 0" title="Предыдущий проход — его покажут блоки цикла" @mousedown.prevent @click="go1(-1)"><Icon name="chevronLeft" :size="12" /></button>
          <span class="pn">{{ passes[cur] ? passTitle(passes[cur]) : '' }}</span>
          <button class="ib" :disabled="cur >= passes.length - 1" title="Следующий проход" @mousedown.prevent @click="go1(1)"><Icon name="chevronRight" :size="12" /></button>
        </template>
        <MenuButton v-if="showPasses && table" icon="download" title="Проходы: скопировать или сохранить в Excel / CSV" :width="240" :items="grid.exportItems.value" />
      </div>
      <DataGrid v-if="showPasses && table" :grid="grid" :max-height="260" />
      <div v-for="(l, i) in lr.logs ?? []" :key="i" class="lg" :class="l.level">{{ l.text }}</div>
      <p v-if="lr.error" class="bl-er">{{ lr.error }}</p>
      <template v-if="lr.hasValue">
        <div class="vh">
          <button class="fold" @mousedown.prevent @click="showValue = !showValue"><Icon name="chevronRight" :size="12" :style="showValue ? 'transform: rotate(90deg)' : ''" /></button>
          <b>Вернул</b><span class="muted">{{ summary(lr.value) }}</span>
        </div>
        <CodeArea v-if="showValue" :model-value="pretty(lr.value)" :lang="typeof lr.value === 'object' ? 'json' : 'text'" readonly :min-height="24" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.bl {
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 8px;
  border: 1px solid rgb(var(--accent-rgb) / 0.45);
  border-left: 3px solid var(--accent);
  border-radius: 8px 8px 8px 0;
  background: var(--panel);
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  overflow: hidden;
}
.seg button {
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.nm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
}
.nm input {
  width: 52px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
/* a new loop: its kinds to start from */
.bl-pre .muted {
  margin: 0 0 6px;
  font-size: 12px;
}
.bl-pg {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 6px;
}
.bl-pg button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  text-align: left;
}
.bl-pg button:hover {
  border-color: var(--accent);
}
.bl-pg b {
  font-size: 12.5px;
  font-weight: 600;
}
.bl-pg span {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.35;
}
.bl-ed :deep(.cm-editor) {
  max-height: 260px;
}
.bl-hint {
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bl-hint code {
  margin: 0 2px;
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.bl-er {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--down-fg);
  font-size: 12.5px;
  white-space: pre-wrap;
}
.lnk {
  height: 22px;
  padding: 0 8px;
  font-size: 12px;
}
.bl-out {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border-2);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}
.bl-st {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px 6px;
  font-size: 12.5px;
  white-space: nowrap;
}
.pn {
  min-width: 0;
  overflow: hidden;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
  text-overflow: ellipsis;
}
.muted {
  color: var(--muted);
}
.bad {
  color: var(--down-fg);
}
.grow {
  flex: 1;
}
.fold,
.ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.35;
}
.lg {
  margin: 0 6px;
  padding: 1px 8px;
  border-left: 2px solid var(--border-2);
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.lg.warn {
  border-color: #fbbf24;
}
.lg.error {
  border-color: var(--down);
  color: var(--down-fg);
}
.vh {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  font-size: 12px;
}
.bl-out > .bl-er {
  padding: 4px 8px;
}
</style>
