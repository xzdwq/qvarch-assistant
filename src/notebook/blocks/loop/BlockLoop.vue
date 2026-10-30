<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ValueView from '../../ui/ValueView.vue'
import { bodyVars, findLoops, LOOP_CLOSE_MD, LOOP_MAX, LOOP_PARALLEL_LIMIT, LOOP_TIMEOUT, loopKey, loopOpenMd, loopStartAt, parsePause, pauseText, type LoopInfo, type LoopPause } from '@nb/domain/loop'
import { summary } from '@nb/domain/values'
import { loopHasPw, loopReport, noteRun, passTitle, pickPass, runLoopAt, stopLoopAt, type BlockRun, type RunState } from '@nb/engine'
import { doc } from '@renderer/lib/notebook'
import { useFold } from '@renderer/lib/foldState'
import { asGrid, useGrid } from '@renderer/lib/grid'
import { LOOP_PRESETS, type LoopPreset } from '@shared/loopPresets'
import type { MenuItem } from '@renderer/components/MenuButton.vue'
import CodeArea from '@renderer/components/CodeArea.vue'
import DataGrid from '@renderer/components/DataGrid.vue'
import Icon from '@renderer/components/Icon.vue'
import MenuButton from '@renderer/components/MenuButton.vue'
import RunHead from '../../ui/RunHead.vue'

/**
 * A loop's start: its head — plain JS / TS that calls `body({ … })` for each pass (the blocks down to the loop's end
 * run with those names) — its settings (passes at once, passes at most), ▶ / ■, how its passes went.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parsed = computed(() => loopStartAt(props.src.split('\n'), 0) ?? { line1: 1, info: { parallel: 1, max: LOOP_MAX, timeout: LOOP_TIMEOUT } as LoopInfo, head: '', ts: false })
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
/** The pause typed («5», «2-8»; empty or not one — none); what it came to. */
function setPause(v: string): LoopPause | undefined {
  const pause = parsePause(v)
  set({ pause })
  return pause
}
const num = (v: string, lo: number, hi: number, def: number) => Math.min(hi, Math.max(lo, Math.floor(Number(v)) || def))

const key = computed(() => loopKey(info.value.name, props.line))
const range = computed(() => findLoops(doc(props.path).text.split('\n')).find((l) => l.line0 === props.line))
const closed = computed(() => range.value?.end !== undefined)
const lr = computed(() => noteRun(props.path).loops[key.value])
const asRun = computed(() => lr.value as unknown as BlockRun | undefined)
const vars = computed(() => bodyVars(head.value))
const hasPw = computed(() => !!range.value && loopHasPw(doc(props.path).text, range.value))
/** Runs the loop (its head written into the note first): every pass of its blocks. */
async function go(): Promise<void> {
  write(undefined, undefined, true)
  await runLoopAt(props.path, doc(props.path).text, props.line)
}
/** Stops the loop: its head, its passes' blocks. */
const stop = () => stopLoopAt(props.path, doc(props.path).text, props.line, key.value)
/** No end yet: one put right under the head (the loop's blocks — between them). */
const close = () => props.onChange?.(`${mine}\n\n${LOOP_CLOSE_MD}`)

// ---------- how the passes went ----------
/** A pass's state in the passes' table. */
const PASS_STATE_TEXT: Record<RunState, string> = { run: 'выполняется', ok: 'готово', error: 'ошибка' }
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
          состояние: PASS_STATE_TEXT[p.state],
          мс: p.ms === undefined ? null : Math.round(p.ms),
          ошибка: p.error ?? null,
        })),
      )
    : undefined,
)
const grid = useGrid(table, () => info.value.name ?? 'Проходы')
const cur = computed(() => lr.value?.sel ?? passes.value.length - 1)
const go1 = (d: number) => pickPass(props.path, key.value, Math.min(passes.value.length - 1, Math.max(0, cur.value + d)))
const report = () => loopReport(lr.value, info.value.name ?? key.value)
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
  <div class="bl tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-accent/45 tw:[&&]:border-l-3 tw:[&&]:border-l-accent tw:rounded-[8px_8px_8px_0] tw:bg-panel" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="report" icon="repeat" kind="Цикл" :name="info.name" :run="asRun" :can-run="closed" name-placeholder="проходы" @rename="(name) => set({ name })" @run="go" @stop="stop">
      <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !parsed.ts }" @mousedown.prevent @click="write(info, false, true)">JS</button>
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: parsed.ts }" title="TypeScript: типы просто убираются перед выполнением" @mousedown.prevent @click="write(info, true, true)">TS</button>
      </span>
      <label class="nm tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap" :title="hasPw ? 'В цикле есть сценарий Playwright — проходы идут по одному' : `Сколько проходов одновременно (до ${LOOP_PARALLEL_LIMIT}). Работает, когда заголовок не ждёт каждый проход: await Promise.all(items.map((x) => body({ x })))`"
        >параллельно<input class="tw:w-52 tw:h-22 tw:py-0 tw:px-4 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" type="number" min="1" :max="LOOP_PARALLEL_LIMIT" :value="info.parallel" :disabled="hasPw" @change="set({ parallel: num(($event.target as HTMLInputElement).value, 1, LOOP_PARALLEL_LIMIT, 1) })"
      /></label>
      <label class="nm tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap" title="Больше проходов — цикл останавливается: защита от бесконечного while"
        >макс.<input class="tw:w-52 tw:h-22 tw:py-0 tw:px-4 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" type="number" min="1" :value="info.max" @change="set({ max: num(($event.target as HTMLInputElement).value, 1, 100000, LOOP_MAX) })"
      /></label>
      <label class="nm tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap" title="Пауза между проходами, секунды: 5 — ровно 5; 2-8 — случайно от 2 до 8 каждый раз (дробные — 0.5-1.5). Пусто — без паузы. Параллельные проходы стартуют с этой паузой друг за другом"
        >пауза<input class="tw:w-60 tw:h-22 tw:py-0 tw:px-4 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" placeholder="сек" spellcheck="false" :value="pauseText(info.pause)" @change="($event.target as HTMLInputElement).value = pauseText(setPause(($event.target as HTMLInputElement).value))" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      /></label>
      <MenuButton icon="list" title="Заполнить заголовок готовым видом цикла: for…of, счётчик, for…in, Object.entries, while, параллельно…" :width="280" :items="presetItems" />
    </RunHead>
    <div v-if="!head.trim()" class="bl-pre">
      <p class="muted tw:mt-0 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-[12px] tw:text-muted">Выберите вид цикла — код заполнится (по {{ names.list }} / {{ names.obj }} — имена можно поменять):</p>
      <div class="bl-pg tw:grid tw:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] tw:gap-6">
        <button class="tw:flex tw:flex-col tw:items-start tw:gap-2 tw:min-w-0 tw:py-6 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:text-left tw:hover:border-accent" v-for="p in LOOP_PRESETS" :key="p.id" :title="p.code(names.list, names.obj)" @mousedown.prevent @click="usePreset(p)">
          <b class="tw:text-[12.5px] tw:font-semibold">{{ p.title }}</b><span class="tw:overflow-hidden tw:text-muted tw:text-[11px] tw:leading-[1.35]">{{ p.hint }}</span>
        </button>
      </div>
    </div>
    <div class="bl-ed"><CodeArea v-model="head" :lang="parsed.ts ? 'typescript' : 'js'" :run="go" :min-height="24" placeholder="for (const [i, item] of items.entries()) await body({ i, item })" /></div>
    <p class="bl-hint tw:m-0 tw:overflow-hidden tw:text-muted tw:text-[11.5px] tw:text-ellipsis tw:whitespace-nowrap" title="Заголовок — обычный JS: for…of, for…in, Object.entries, while, условия, try/catch, break.&#10;await body({ … }) — проход за проходом; await Promise.all(xs.map((x) => body({ x }))) — параллельно.&#10;body() возвращает то, что опубликовали блоки прохода: const r = await body({ page }); if (!r.list.body.next) break&#10;Внутри цикла: loop.n — номер прохода (с 1), loop.index — с 0.">
      <code class="tw:my-0 tw:mx-2 tw:text-accent-fg tw:font-data">body({ … })</code> — проход: блоки до конца цикла получают эти имена<template v-if="vars.length">: <code class="tw:my-0 tw:mx-2 tw:text-accent-fg tw:font-data" v-for="v in vars" :key="v">{{ v }}</code></template>, и <code class="tw:my-0 tw:mx-2 tw:text-accent-fg tw:font-data">loop.n</code>
    </p>
    <p v-if="!closed" class="bl-er tw:flex tw:items-center tw:gap-8 tw:m-0 tw:text-down-fg tw:text-[12.5px] tw:whitespace-pre-wrap">Нет конца цикла.<button class="lnk tw:h-22 tw:py-0 tw:px-8 tw:text-[12px]" @mousedown.prevent @click="close">Добавить конец</button></p>
    <div v-if="lr" class="bl-out tw:flex tw:flex-col tw:gap-2 tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg tw:overflow-hidden">
      <div class="bl-st tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:py-2 tw:px-6 tw:text-[12.5px] tw:whitespace-nowrap">
        <button class="fold tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="showPasses ? 'Скрыть проходы' : 'Показать проходы таблицей'" @mousedown.prevent @click="showPasses = !showPasses"><Icon name="chevronRight" :size="12" :style="showPasses ? 'transform: rotate(90deg)' : ''" /></button>
        <b>Проходов {{ passes.length }}</b>
        <span v-if="running" class="muted tw:text-muted">· выполняется {{ running }}</span>
        <span v-if="bad" class="bad tw:text-down-fg">· с ошибкой {{ bad }}</span>
        <span v-if="lr.trimmed" class="muted tw:text-muted" title="Результаты старых проходов не сохранены — их значения остались">· старых без подробностей {{ lr.trimmed }}</span>
        <span class="grow tw:flex-1"></span>
        <template v-if="passes.length > 1">
          <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :disabled="cur <= 0" title="Предыдущий проход — его покажут блоки цикла" @mousedown.prevent @click="go1(-1)"><Icon name="chevronLeft" :size="12" /></button>
          <span class="pn tw:min-w-0 tw:overflow-hidden tw:text-text-2 tw:font-data tw:text-[11.5px] tw:text-ellipsis">{{ passes[cur] ? passTitle(passes[cur]) : '' }}</span>
          <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :disabled="cur >= passes.length - 1" title="Следующий проход" @mousedown.prevent @click="go1(1)"><Icon name="chevronRight" :size="12" /></button>
        </template>
        <MenuButton v-if="showPasses && table" icon="download" title="Проходы: скопировать или сохранить в Excel / CSV" :width="240" :items="grid.exportItems.value" />
      </div>
      <DataGrid v-if="showPasses && table" :grid="grid" :max-height="260" />
      <div v-for="(l, i) in lr.logs ?? []" :key="i" class="lg tw:my-0 tw:mx-6 tw:py-1 tw:px-8 tw:border-l-2 tw:border-l-border-2 tw:text-text-2 tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word] tw:[&.error]:border-down tw:[&.error]:text-down-fg" :class="l.level">{{ l.text }}</div>
      <p v-if="lr.error" class="bl-er tw:flex tw:items-center tw:gap-8 tw:m-0 tw:text-down-fg tw:text-[12.5px] tw:whitespace-pre-wrap tw:py-4 tw:px-8">{{ lr.error }}</p>
      <template v-if="lr.hasValue">
        <div class="vh tw:flex tw:items-center tw:gap-4 tw:py-0 tw:px-6 tw:text-[12px]">
          <button class="fold tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @mousedown.prevent @click="showValue = !showValue"><Icon name="chevronRight" :size="12" :style="showValue ? 'transform: rotate(90deg)' : ''" /></button>
          <b>Вернул</b><span class="muted tw:text-muted">{{ summary(lr.value) }}</span>
        </div>
        <ValueView v-if="showValue" :value="lr.value" :name="info.name" />
      </template>
    </div>
  </div>
</template>

<style scoped src="./BlockLoop.css"></style>
