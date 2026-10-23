<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch, type Ref } from 'vue'
import { compareTexts, foldRows, type DiffOptions, type View } from '@shared/textDiff'
import { canFormat, detectKind, formatKind, kindTitle, type CodeKind } from '../../lib/codeLang'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'

/**
 * Two texts side by side and what differs: lines put in / taken out / changed (only them — git's way of
 * comparing), the changed words inside a line lit, long equal stretches folded. JSON is formatted (keys sorted)
 * before it is compared.
 */
const KEY = 'qa.tools.diff'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DiffOptions> & { split?: number }
  } catch {
    return {}
  }
})()
const opt = reactive<DiffOptions>({ mode: saved.mode ?? 'auto', ignoreSpace: !!saved.ignoreSpace, ignoreCase: !!saved.ignoreCase, sortKeys: saved.sortKeys ?? true })
const split = ref(Math.min(0.7, Math.max(0.15, saved.split ?? 0.38)))
watch([opt, split], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...opt, split: split.value }))
  } catch {
    // fine
  }
})
const left = ref('')
const right = ref('')
// compared a moment after typing stops (big texts stay smooth)
const a = ref('')
const b = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch([left, right], () => {
  clearTimeout(timer)
  timer = setTimeout(() => ((a.value = left.value), (b.value = right.value)), 250)
})
const result = computed(() => compareTexts(a.value, b.value, opt))
const looksJson = computed(() => result.value.json)
/** What the texts are (Авто: guessed from them — JSON, SQL, XML, HTML, YAML…; one side is enough). */
const kind = computed<CodeKind | undefined>(() => {
  if (opt.mode === 'text') return undefined
  if (opt.mode === 'json' || looksJson.value) return 'json'
  const l = detectKind(a.value)
  const r = detectKind(b.value)
  return l && r && l !== r ? undefined : (l ?? r)
})
const lang = computed(() => kind.value ?? 'text')
const opened = ref(new Set<number>())
watch(result, () => (opened.value = new Set()))
const view = computed<View[]>(() => foldRows(result.value.rows, 3, opened.value))
function unfold(from: number, to: number): void {
  const s = new Set(opened.value)
  for (let i = from; i < to; i++) s.add(i)
  opened.value = s
}
const empty = computed(() => !a.value.trim() && !b.value.trim())

// ---------- going from change to change ----------
/** The first row of each change (a run of changed rows is one change). */
const changes = computed(() => result.value.rows.flatMap((r, i, all) => (r.kind !== 'same' && (i === 0 || all[i - 1].kind === 'same') ? [i] : [])))
const at = ref(-1)
watch(changes, () => (at.value = -1))
const out = ref<HTMLElement>()
async function goChange(dir: 1 | -1): Promise<void> {
  const n = changes.value.length
  if (!n) return
  at.value = at.value < 0 ? (dir > 0 ? 0 : n - 1) : (at.value + dir + n) % n
  const row = changes.value[at.value]
  // a change folded away — opened first
  if (!view.value.some((v) => 'row' in v && v.i === row)) unfold(row, row + 1)
  await nextTick()
  out.value?.querySelector(`[data-i="${row}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
const current = computed(() => (at.value >= 0 ? changes.value[at.value] : -1))

// ---------- the inputs ----------
const fmtErr = ref<{ l?: string; r?: string }>({})
watch([left, right], () => (fmtErr.value = {}))
/** Both sides formatted as their kind (a side that does not parse stays and says why). */
async function formatBoth(): Promise<void> {
  const k = kind.value
  if (!canFormat(k)) return
  const one = async (t: string) => {
    if (!t.trim()) return { t }
    try {
      return { t: await formatKind(k, t, { sortKeys: opt.sortKeys }) }
    } catch (e) {
      return { t, err: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 160) }
    }
  }
  const [l, r] = await Promise.all([one(left.value), one(right.value)])
  left.value = l.t
  right.value = r.t
  fmtErr.value = { l: l.err, r: r.err }
}
function swap(): void {
  ;[left.value, right.value] = [right.value, left.value]
}
function clearAll(): void {
  left.value = ''
  right.value = ''
}
type Side = 'l' | 'r'
/** Each input (left to right): its title and placeholder, its text, why it does not format / is not JSON. */
interface SideSpec {
  label: string
  placeholder: string
  text: Ref<string>
  formatError: () => string | undefined
  jsonError: () => string | undefined
}
const SIDES: Record<Side, SideSpec> = {
  l: { label: 'Было', placeholder: 'Вставьте первый текст: JSON, SQL, XML, YAML…', text: left, formatError: () => fmtErr.value.l, jsonError: () => result.value.error?.left },
  r: { label: 'Стало', placeholder: 'Вставьте второй текст', text: right, formatError: () => fmtErr.value.r, jsonError: () => result.value.error?.right },
}
const SIDE_ORDER = Object.keys(SIDES) as Side[]
/** How the texts are compared (the bar's switch). */
const MODES: Array<{ id: DiffOptions['mode']; label: string; title?: string }> = [
  { id: 'auto', label: 'Авто', title: 'Формат определяется по тексту: JSON (сравнение по структуре), SQL, XML, HTML, YAML, JS… или просто текст' },
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'Текст' },
]
async function paste(side: Side): Promise<void> {
  SIDES[side].text.value = await navigator.clipboard.readText()
}
const lines = (s: string) => (s ? s.split('\n').length : 0)
const area = ref<HTMLElement>()
function dragSplit(e: PointerEvent): void {
  e.preventDefault()
  const box = area.value?.getBoundingClientRect()
  if (!box) return
  const move = (ev: PointerEvent) => (split.value = Math.min(0.7, Math.max(0.15, (ev.clientY - box.top) / box.height)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'row-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="dt tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="bar tw:flex-none tw:flex tw:items-center tw:gap-12 tw:h-38 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-14 tw:border-b tw:border-b-border tw:whitespace-nowrap tw:overflow-hidden">
      <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
        <button class="tw:h-26 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" v-for="m in MODES" :key="m.id" :class="{ on: opt.mode === m.id }" :title="m.title ?? ''" @click="opt.mode = m.id">{{ m.label }}</button>
      </span>
      <span v-if="opt.mode === 'auto'" class="kind tw:flex-none tw:py-2 tw:px-8 tw:border tw:border-accent/45 tw:rounded-r2 tw:text-accent-fg tw:font-data tw:text-[11px] tw:[&.none]:border-border-2 tw:[&.none]:text-muted" :class="{ none: !kind }" :title="kind ? 'Формат определён по тексту' : 'Формат не определён — сравнение как текст'">{{ kind ? kindTitle(kind) : 'текст' }}</span>
      <label v-if="kind === 'json' || kind === 'yaml'" class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]" title="Порядок ключей в объектах не считается изменением"><input v-model="opt.sortKeys" type="checkbox" />Сортировать ключи</label>
      <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]" title="Пробелы в начале / конце строк и их количество не считаются"><input v-model="opt.ignoreSpace" type="checkbox" />Без пробелов</label>
      <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]"><input v-model="opt.ignoreCase" type="checkbox" />Без регистра</label>
      <span class="grow tw:flex-1"></span>
      <button class="fmt tw:flex-none tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" :disabled="!canFormat(kind)" :title="canFormat(kind) ? `Отформатировать ${kindTitle(kind)} в обоих полях` : 'Формат не определён — форматировать нечего'" @click="formatBoth"><Icon name="code" :size="13" />Форматировать</button>
      <button class="ib tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Поменять местами" @click="swap"><Icon name="repeat" :size="14" /></button>
      <button class="ib tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Очистить оба поля" :disabled="!left && !right" @click="clearAll"><Icon name="trash" :size="14" /></button>
    </div>

    <div ref="area" class="area tw:flex-1 tw:min-h-0 tw:grid" :style="{ gridTemplateRows: `${split * 100}% 6px minmax(0, 1fr)` }">
      <div class="ins tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-1 tw:min-h-0 tw:bg-border">
        <div v-for="side in SIDE_ORDER" :key="side" class="in tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:bg-bg">
          <div class="ih tw:flex-none tw:flex tw:items-center tw:gap-8 tw:h-30 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-12 tw:text-[12px] tw:whitespace-nowrap tw:overflow-hidden">
            <b class="tw:text-text-hi">{{ SIDES[side].label }}</b>
            <span class="muted tw:text-muted">{{ lines(SIDES[side].text.value) }} стр.</span>
            <span v-if="SIDES[side].formatError()" class="err tw:overflow-hidden tw:text-ellipsis tw:text-down-fg" :title="SIDES[side].formatError()">не форматируется: {{ SIDES[side].formatError() }}</span>
            <span v-else-if="SIDES[side].jsonError()" class="err tw:overflow-hidden tw:text-ellipsis tw:text-down-fg" :title="SIDES[side].jsonError()">не JSON: {{ SIDES[side].jsonError() }}</span>
            <span class="grow tw:flex-1"></span>
            <button class="ib sm tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:w-24 tw:h-24 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Вставить из буфера" @click="paste(side)"><Icon name="clipboard" :size="12" /></button>
          </div>
          <div class="ed tw:flex-1 tw:min-h-0 tw:pt-0 tw:pr-6 tw:pb-6 tw:pl-6">
            <CodeArea v-model="SIDES[side].text.value" :lang="lang" fill :min-height="0" :placeholder="SIDES[side].placeholder" />
          </div>
        </div>
      </div>
      <div class="hsplit tw:bg-border tw:cursor-row-resize tw:hover:bg-accent/85" title="Потяните — высота полей" @pointerdown="dragSplit"></div>

      <div class="res tw:flex tw:flex-col tw:min-h-0">
        <div class="rh tw:flex-none tw:flex tw:items-center tw:gap-10 tw:h-32 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-14 tw:border-b tw:border-b-border tw:text-[12.5px] tw:whitespace-nowrap">
          <b class="tw:text-text-hi">Различия</b>
          <template v-if="!empty">
            <span v-if="result.json" class="tag tw:py-1 tw:px-6 tw:rounded-r1 tw:bg-panel-3 tw:text-text-2 tw:font-data tw:text-[10.5px]">JSON</span>
            <span v-if="result.stats.same" class="ok tw:text-up-fg">Тексты одинаковые</span>
            <template v-else>
              <span class="st add tw:font-data tw:font-semibold tw:text-up-fg" title="Добавлено строк">+{{ result.stats.added }}</span>
              <span class="st del tw:font-data tw:font-semibold tw:text-down-fg" title="Удалено строк">−{{ result.stats.removed }}</span>
              <span class="st mod tw:font-data tw:font-semibold tw:text-warn-fg" title="Изменено строк">~{{ result.stats.changed }}</span>
            </template>
          </template>
          <span class="grow tw:flex-1"></span>
          <template v-if="changes.length">
            <span class="muted tw:text-muted">{{ at < 0 ? changes.length : `${at + 1} / ${changes.length}` }} изм.</span>
            <button class="ib sm tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:w-24 tw:h-24 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Предыдущее изменение" @click="goChange(-1)"><Icon name="chevronLeft" :size="13" style="transform: rotate(90deg)" /></button>
            <button class="ib sm tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:w-24 tw:h-24 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Следующее изменение" @click="goChange(1)"><Icon name="chevronRight" :size="13" style="transform: rotate(90deg)" /></button>
          </template>
        </div>
        <div ref="out" class="dv tw:flex-1 tw:min-h-0 tw:overflow-auto tw:font-data tw:text-[12.5px] tw:leading-[1.55]">
          <p v-if="empty" class="hint tw:m-16 tw:text-muted tw:font-ui">Вставьте два текста сверху — различия появятся здесь. JSON сравнивается по смыслу: форматирование и порядок ключей не считаются изменениями.</p>
          <template v-else>
            <template v-for="(v, k) in view" :key="k">
              <button v-if="'fold' in v" class="fold tw:block tw:w-full tw:h-26 tw:py-0 tw:px-14 tw:border-0 tw:rounded-none tw:[&&]:border-t tw:[&&]:[border-top-style:dashed] tw:[&&]:border-t-border-2 tw:[&&]:border-b tw:[&&]:[border-bottom-style:dashed] tw:[&&]:border-b-border-2 tw:bg-panel tw:text-muted tw:font-ui tw:text-[12px] tw:text-left tw:hover:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="unfold(v.from, v.to)">⋯ {{ v.fold }} одинаковых строк — показать</button>
              <div v-else class="row tw:grid tw:grid-cols-[46px_minmax(0,1fr)_46px_minmax(0,1fr)] tw:[&.cur]:[outline:1px_solid_var(--accent)] tw:[&.cur]:[outline-offset:-1px]" :class="[v.row.kind, { cur: v.i === current }]" :data-i="v.i">
                <span class="n tw:py-0 tw:px-8 tw:text-dim tw:text-right tw:select-none tw:border-r tw:border-r-border tw:[.row.del_&]:first:bg-down/13 tw:[&&]:[.row.add_&]:nth-3:bg-up/11">{{ v.row.l?.n ?? '' }}</span>
                <span class="t l tw:py-0 tw:px-10 tw:whitespace-pre-wrap tw:break-all tw:min-h-[1.55em] tw:[&.none]:not-[.row.del_&]:not-[.row.mod_&]:[background:repeating-linear-gradient(-45deg,transparent_0_5px,rgba(255,255,255,0.025)_5px_10px)] tw:[.row.del_&]:not-[.row.mod_&]:bg-down/13 tw:[.row.mod_&]:bg-down/7" :class="{ none: !v.row.l }"><template v-for="(s, j) in v.row.l?.segs ?? []" :key="j"><mark class="tw:[.row.mod_&]:bg-down/35 tw:[.row.mod_&]:text-text-hi tw:[.row.mod_&]:rounded-[2px]" v-if="s.hl && v.row.kind === 'mod'">{{ s.t }}</mark><template v-else>{{ s.t }}</template></template></span>
                <span class="n tw:py-0 tw:px-8 tw:text-dim tw:text-right tw:select-none tw:border-r tw:border-r-border tw:[.row.del_&]:first:bg-down/13 tw:[&&]:[.row.add_&]:nth-3:bg-up/11">{{ v.row.r?.n ?? '' }}</span>
                <span class="t r tw:py-0 tw:px-10 tw:whitespace-pre-wrap tw:break-all tw:min-h-[1.55em] tw:border-l tw:border-l-border tw:[&.none]:not-[.row.add_&]:not-[.row.mod_&]:[background:repeating-linear-gradient(-45deg,transparent_0_5px,rgba(255,255,255,0.025)_5px_10px)] tw:[.row.add_&]:not-[.row.mod_&]:bg-up/11 tw:[.row.mod_&]:bg-up/6" :class="{ none: !v.row.r }"><template v-for="(s, j) in v.row.r?.segs ?? []" :key="j"><mark class="tw:[.row.mod_&]:bg-up/30 tw:[.row.mod_&]:text-text-hi tw:[.row.mod_&]:rounded-[2px]" v-if="s.hl && v.row.kind === 'mod'">{{ s.t }}</mark><template v-else>{{ s.t }}</template></template></span>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./DiffTool.css"></style>
