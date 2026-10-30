<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ValueView from '../../ui/ValueView.vue'
import { useFold } from '@renderer/lib/foldState'
import { doc, save, setText } from '@renderer/lib/notebook'
import { blockRunKey, fencedBlocksOf } from '@nb/domain/noteBlocks'
import { summary } from '@nb/domain/values'
import { isTsLang, type BlockInfo, type PwBrowser } from '@nb/domain/blockInfo'
import { errorText } from '@nb/engine'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import RunHead from '../../ui/RunHead.vue'
import { useBlockRun } from '../../ui/useBlockRun'
import { useFenceSource } from '../../ui/useFenceSource'
import MatrixEditor from './MatrixEditor.vue'
import FuzzEditor from './FuzzEditor.vue'
import { readFuzz } from '@shared/fuzz'
import { pwRec, startPwRec, stopPwRec } from '@renderer/lib/pwrec'
import { QA_CHECKS, checksFor, checksIn, fileSetOf, layoutModeOf, setFileSet, setLayoutMode, unwrapCheck, type QaCheckKind } from '@shared/qaChecks'
import { withCheck } from './model'
import type { TestFileSet } from '@shared/testFiles'
import Popover from '@renderer/components/Popover.vue'

/**
 * A browser scenario in a note (Playwright): the installed Edge / Chrome, headless or with its window.
 * page / context / expect / step() / set() and the note's values; its steps go by while it runs; what it left:
 * a screenshot, the trace (Trace Viewer in the app's browser) and Allure results.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { info, body: code } = fence
const { key, run, start, stop, report, values } = useBlockRun(props, 'pw', fence)
const ts = computed(() => isTsLang(info.value.lang))
const patch = (p: Partial<BlockInfo>) => fence.patchInfo(p)

// ---------- «Проверить ▾»: the recorded actions wrapped into a ready check ----------
// (its list fits the window: as high as there is room, scrolled beyond)
const ckOpen = ref(false)
const ckBtn = ref<HTMLElement>()
const ckErr = ref('')
// the matrix's values (its editor under the chips)
const mxOpen = ref(false)
// the request's parameters to try (open while no request is chosen: there is nothing to run yet)
const fzOpen = ref(false)
watch(
  () => /\bqa\.fuzz\(/.test(code.value) && !readFuzz(code.value)?.spec.request,
  (empty) => empty && (fzOpen.value = true),
  { immediate: true },
)
// the run per file: its set (the notebook's test files)
const fileSet = computed(() => fileSetOf(code.value) ?? '')
const fileSets = ref<TestFileSet[]>([])
const loadSets = async () => (fileSets.value = await window.qa.files('sets'))
watch(
  () => /\bqa\.eachFile\(/.test(code.value),
  (on) => on && void loadSets(),
  { immediate: true },
)

// ---------- the layout's way: the page at its line / the whole scenario on each screen / a scenario per screen ----------
const recordPerScreen = ref(false)
const lmode = computed(() => (recordPerScreen.value ? 'record' : (layoutModeOf(code.value) ?? 'here')))
function setLMode(m: 'here' | 'each' | 'record'): void {
  ckErr.value = ''
  recordPerScreen.value = m === 'record'
  if (m === 'record') return
  const r = setLayoutMode(code.value, m)
  if ('error' in r) return void (ckErr.value = r.error)
  code.value = r.code
  // the scenario on four screens — four times its time
  if (m === 'each' && (info.value.timeout ?? 0) < 600) patch({ timeout: 600 })
}
const SCREENS = [
  { w: 375, h: 812, label: 'телефон' },
  { w: 768, h: 1024, label: 'планшет' },
  { w: 1280, h: 800, label: 'ноутбук' },
  { w: 1920, h: 1080, label: 'монитор' },
]
/** A block of its own for a screen, under this one: recorded in the Браузер at that size, its layout checked at the end. */
async function recFor(s: { w: number; h: number }): Promise<void> {
  recErr.value = ''
  const url = /page\.goto\(\s*['"`]([^'"`]+)['"`]/.exec(code.value)?.[1]
  if (!url || !/^https?:/.test(url)) return void (recErr.value = 'В сценарии нет адреса страницы (page.goto) — с чего начать запись')
  fence.flush()
  const d = doc(props.path)
  const lines = d.text.split('\n')
  const blocks = fencedBlocksOf(d.text)
  const me = blocks.find((b) => b.kind === 'pw' && b.line0 === props.line)
  if (!me) return
  const taken = new Set(blocks.map((b) => b.info.name))
  let name = `${info.value.name || 'сценарий'}-${s.w}`
  for (let n = 2; taken.has(name); n++) name = `${info.value.name || 'сценарий'}-${s.w}-${n}`
  lines.splice(me.line1, 0, '', `\`\`\`ts playwright name=${name} session timeout=300`, '```')
  setText(props.path, lines.join('\n'))
  await save(props.path)
  try {
    await startPwRec(props.path, blockRunKey(name, 'pw', me.line1 + 2), url, {
      screen: { w: s.w, h: s.h },
      tail: [`await qa.layout({ widths: [${s.w}], zooms: [80, 100, 125] }) // шаг: Вёрстка на экране ${s.w} px`],
    })
  } catch (e) {
    recErr.value = errorText(e)
  }
}
// the checks in the scenario now, in their order (a chip each — a click on its × takes it out)
const present = computed(() => checksIn(code.value))
const labelOf = (k: QaCheckKind) => QA_CHECKS.find((c) => c.id === k)!.label
function dropCheck(k: QaCheckKind): void {
  code.value = unwrapCheck(code.value, k)
  ckErr.value = ''
}
function addCheck(k: QaCheckKind): void {
  // the menu — a switch: one already in the scenario is taken out
  if (present.value.includes(k)) return void (dropCheck(k), (ckOpen.value = false))
  const r = withCheck(info.value, code.value, k)
  if ('error' in r) return void (ckErr.value = r.error)
  code.value = r.code
  ckErr.value = ''
  ckOpen.value = false
  if (r.info.timeout !== info.value.timeout) patch({ timeout: r.info.timeout })
}
const menuChecks = computed(() => checksFor(code.value))

// ---------- the layout check's pictures (the run's folder) ----------
const shotUrls = ref<Record<string, string>>({})
const bigShot = ref<string>()
watch(
  () => [run.value?.at, (run.value?.checks ?? []).flatMap((c) => c.shots?.map((x) => x.file) ?? []).join()] as const,
  async ([at, files]) => {
    for (const u of Object.values(shotUrls.value)) URL.revokeObjectURL(u)
    shotUrls.value = {}
    if (!at || !files || run.value?.state === 'run') return
    const out: Record<string, string> = {}
    for (const file of files.split(',')) {
      try {
        const bytes = await window.qa.runFile(props.path, key.value, file)
        out[file] = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
      } catch {
        // gone (an older run)
      }
    }
    shotUrls.value = out
  },
  { immediate: true },
)
/** Runs the scenario as typed (written into the note first). */
async function go(): Promise<void> {
  fence.flush()
  await start()
}
const BROWSERS: Array<{ id: PwBrowser; label: string; title: string }> = [
  { id: 'msedge', label: 'Edge', title: 'Microsoft Edge, установленный в системе' },
  { id: 'chrome', label: 'Chrome', title: 'Google Chrome, установленный в системе' },
]
const vars = computed(() => Object.keys(values()))
// (folded or open — as it was left, back from another tab too)
const showValue = useFold(() => `${props.path}#${key.value}#result`, false)

// the screenshot it left (the last page, or where it failed)
const shot = ref<string>()
const shotName = computed(() => run.value?.files?.find((f) => f.endsWith('.png')))
const big = ref(false)
watch(
  () => [run.value?.at, shotName.value] as const,
  async ([, name]) => {
    if (shot.value) URL.revokeObjectURL(shot.value)
    shot.value = undefined
    if (!name || run.value?.state === 'run') return
    try {
      const bytes = await window.qa.runFile(props.path, key.value, name)
      shot.value = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
    } catch {
      // gone (the run's files were cleared)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => shot.value && URL.revokeObjectURL(shot.value))
const hasTrace = computed(() => run.value?.files?.includes('trace.zip'))
const hasAllure = computed(() => run.value?.files?.includes('allure-results'))
const traceErr = ref('')
async function openTrace(): Promise<void> {
  traceErr.value = ''
  try {
    await window.qa.pwTrace(props.path, key.value)
  } catch (e) {
    traceErr.value = errorText(e)
  }
}
// recording the scenario in the Браузер
const recUrl = ref<string>()
const recording = computed(() => pwRec.value?.note === props.path && pwRec.value?.key === key.value)
function askRec(): void {
  const m = /page\.goto\(\s*['"`]([^'"`]+)['"`]/.exec(code.value)
  recUrl.value = m && /^https?:/.test(m[1]) ? m[1] : 'https://'
}
const recErr = ref('')
async function rec(): Promise<void> {
  recErr.value = ''
  const url = (recUrl.value ?? '').trim()
  try {
    fence.flush()
    await startPwRec(props.path, key.value, url)
    recUrl.value = undefined
  } catch (e) {
    recErr.value = errorText(e)
  }
}
const allure = () => window.qa.pwAllure(props.path, key.value)
const msText = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`)
</script>

<template>
  <div class="bp tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-block-pw tw:rounded-[8px] tw:bg-panel tw:[.st.ok>&]:first:text-up-fg" @keydown.ctrl.enter.prevent="go">
    <RunHead :report="report" send="pw" :src="src" icon="globe" kind="Playwright" :name="info.name" :run="run" can-run name-placeholder="сценарий" @rename="(name) => patch({ name })" @run="go" @stop="stop">
      <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !ts }" @mousedown.prevent @click="patch({ lang: 'js' })">JS</button>
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: ts }" title="TypeScript: типы просто убираются перед выполнением" @mousedown.prevent @click="patch({ lang: 'ts' })">TS</button>
      </span>
    </RunHead>
    <div v-if="recording" class="recon tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border tw:border-stop/45 tw:rounded-[6px] tw:bg-stop/8 tw:text-[12px]"><i class="prd tw:flex-none tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-stop tw:animate-[BlockPw-prblink_1.2s_ease-in-out_infinite]"></i>Идёт запись в Браузере · строк: {{ pwRec!.count }}<span class="grow tw:flex-1"></span><button class="tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12px]" @mousedown.prevent @click="stopPwRec()">Стоп — вставить сюда</button><button class="tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12px]" @mousedown.prevent @click="stopPwRec(true)">Отменить</button></div>
    <div v-else-if="recUrl !== undefined" class="recon ask tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border tw:border-stop/45 tw:rounded-[6px] tw:bg-stop/8 tw:text-[12px]">
      <i class="prd tw:flex-none tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-stop tw:animate-[BlockPw-prblink_1.2s_ease-in-out_infinite]"></i><span>С какой страницы начать:</span>
      <input class="tw:flex-1 tw:min-w-120 tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12px]" v-model="recUrl" spellcheck="false" placeholder="https://…" @keydown.enter.prevent="rec" @keydown.esc.prevent="recUrl = undefined" />
      <button class="go tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:text-[12px] tw:[&&]:border-stop tw:bg-stop tw:text-white" @mousedown.prevent @click="rec">Записать</button><button class="tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12px]" @mousedown.prevent @click="recUrl = undefined">Отмена</button>
      <span v-if="recErr" class="er tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-down-fg tw:font-data tw:text-[12px] tw:whitespace-pre-wrap">{{ recErr }}</span>
    </div>
    <div class="bp-ed"><CodeArea v-model="code" :lang="ts ? 'typescript' : 'js'" :min-height="40" placeholder="await page.goto('https://…')" /></div>
    <div class="bp-opts tw:flex tw:flex-wrap tw:items-center tw:gap-y-6 tw:gap-x-10 tw:min-w-0">
      <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" v-for="b in BROWSERS" :key="b.id" :class="{ on: (info.browser ?? 'msedge') === b.id }" :title="b.title" @mousedown.prevent @click="patch({ browser: b.id })">{{ b.label }}</button>
      </span>
      <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:font-data tw:text-[11px] tw:whitespace-nowrap" title="Показывать окно браузера во время выполнения (иначе — без окна)"><input type="checkbox" :checked="info.headed" @change="patch({ headed: ($event.target as HTMLInputElement).checked })" />окно</label>
      <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:font-data tw:text-[11px] tw:whitespace-nowrap" title="Записывать трассировку (Trace Viewer): каждое действие со снимком страницы, сеть, консоль"><input type="checkbox" :checked="!info.notrace" @change="patch({ notrace: !($event.target as HTMLInputElement).checked })" />трассировка</label>
        <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:font-data tw:text-[11px] tw:whitespace-nowrap" title="Войти как в разделе «Браузер»: тест получает его cookies — сайт, на который вы вошли там (в том числе через ADFS), открывается уже с входом"><input type="checkbox" :checked="info.session" @change="patch({ session: ($event.target as HTMLInputElement).checked })" />вход из Браузера</label>
        <button class="recb tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:h-22 tw:py-0 tw:px-8 tw:border tw:border-stop/50 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[11.5px] tw:hover:bg-stop/12 tw:hover:enabled:border-border-3" title="Записать сценарий: откроется Браузер, ваши клики и ввод станут строками теста; «Стоп» вернёт сюда" @mousedown.prevent @click="askRec"><i class="prd tw:flex-none tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-stop"></i>Записать</button>
        <button ref="ckBtn" class="ckb tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:text-[12px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg" :class="{ on: ckOpen }" title="Обернуть записанные действия в готовую проверку" @mousedown.prevent @click="(ckOpen = !ckOpen), (ckErr = '')"><Icon name="checkSquare" :size="12" />Проверить<Icon name="chevronDown" :size="10" /></button>
        <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:font-data tw:text-[11px] tw:whitespace-nowrap" title="Ошибка этого сценария не останавливает «Выполнить всё» (ожидаемое падение, нестабильный тест)"><input type="checkbox" :checked="info.soft" @change="patch({ soft: ($event.target as HTMLInputElement).checked })" />не останавливать</label>
      <p v-if="ckErr" class="ck-err tw:m-0 tw:text-down-fg tw:text-[12px]">{{ ckErr }}</p>
      <p v-if="present.length" class="ck-on tw:flex tw:basis-full tw:flex-wrap tw:items-center tw:gap-y-4 tw:gap-x-6 tw:m-0 tw:text-[12px]" title="Проверки выполняются в этом порядке — по строкам сценария">
        <span class="muted tw:text-muted tw:text-[11.5px]">В сценарии:</span>
        <template v-for="(k, i) in present" :key="i"
          ><Icon v-if="i" name="chevronRight" :size="10" class="muted tw:text-muted tw:text-[11.5px]" /><span class="ck-chip tw:inline-flex tw:items-center tw:gap-5 tw:h-22 tw:pt-0 tw:pr-2 tw:pb-0 tw:pl-7 tw:border tw:border-accent/40 tw:rounded-[11px] tw:bg-accent/10 tw:whitespace-nowrap"><Icon name="checkSquare" :size="11" />{{ labelOf(k) }}<button class="tw:inline-grid tw:place-items-center tw:w-18 tw:h-18 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Убрать проверку из сценария" @mousedown.prevent @click="dropCheck(k)"><Icon name="x" :size="10" /></button></span></template
        >
        <button v-if="present.includes('matrix')" class="mx-btn tw:inline-flex tw:items-center tw:gap-5 tw:h-22 tw:ml-4 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-[11px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:not-hover:border-accent tw:hover:border-accent tw:[&.on]:not-hover:text-text tw:hover:text-text tw:hover:enabled:bg-hover" :class="{ on: mxOpen }" title="Свои значения для полей: строки нужной длины, UUID, e-mail, числа, даты, JSON-объекты…" @mousedown.prevent @click="mxOpen = !mxOpen">
          <Icon name="settings" :size="11" />Значения матрицы
        </button>
        <button v-if="present.includes('fuzz')" class="mx-btn tw:inline-flex tw:items-center tw:gap-5 tw:h-22 tw:ml-4 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-[11px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:not-hover:border-accent tw:hover:border-accent tw:[&.on]:not-hover:text-text tw:hover:text-text tw:hover:enabled:bg-hover" :class="{ on: fzOpen }" title="Какой запрос, какие параметры и какими значениями перебирать" @mousedown.prevent @click="fzOpen = !fzOpen">
          <Icon name="settings" :size="11" />Параметры перебора
        </button>
      </p>
      <MatrixEditor v-if="mxOpen && present.includes('matrix')" :code="code" @update="(c) => (code = c)" />
      <FuzzEditor v-if="fzOpen && present.includes('fuzz')" :code="code" @update="(c) => (code = c)" />
      <div v-if="present.includes('files')" class="lay-mode tw:flex tw:basis-full tw:flex-wrap tw:items-center tw:gap-6 tw:text-[12px]">
        <span class="muted tw:text-muted tw:text-[11.5px]">Файлы из набора:</span>
        <select :value="fileSet" title="Сценарий пройдёт по разу с каждым файлом этого набора («Тестовые файлы»)" @focus="loadSets" @change="code = setFileSet(code, ($event.target as HTMLSelectElement).value)">
          <option v-if="!fileSets.some((s) => s.name === fileSet)" :value="fileSet">{{ fileSet }}</option>
          <option v-for="s in fileSets" :key="s.name" :value="s.name">{{ s.name }} · {{ s.count }}</option>
        </select>
      </div>
      <div v-if="present.includes('layout')" class="lay-mode tw:flex tw:basis-full tw:flex-wrap tw:items-center tw:gap-6 tw:text-[12px]">
        <span class="muted tw:text-muted tw:text-[11.5px]">Вёрстка:</span>
        <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
          <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg tw:whitespace-nowrap" :class="{ on: lmode === 'here' }" title="Страница там, где стоит строка проверки, — на всех экранах и масштабах. Действия идут на записанном размере" @mousedown.prevent @click="setLMode('here')">на этой странице</button>
          <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg tw:whitespace-nowrap" :class="{ on: lmode === 'each' }" title="Весь сценарий заново на 375 / 768 / 1280 / 1920 px: где не прошёл (кнопка ушла в меню) — сказано, со снимком; где прошёл — вёрстка в конце. Сценарий, создающий данные, создаст их на каждом экране" @mousedown.prevent @click="setLMode('each')">весь сценарий на каждом экране</button>
          <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg tw:whitespace-nowrap" :class="{ on: lmode === 'record' }" title="Отдельный сценарий для узкого экрана (когда путь там другой: меню, боковая панель): запись в Браузере сразу этого размера, вёрстка в конце" @mousedown.prevent @click="setLMode('record')">свой сценарий для экрана</button>
        </span>
        <template v-if="lmode === 'record'">
          <button v-for="s in SCREENS" :key="s.w" class="scr tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-9 tw:font-data" :disabled="!!pwRec" :title="`Новый блок под этим: запись в Браузере на экране ${s.w}×${s.h} (${s.label}), в конце — вёрстка на этом экране`" @mousedown.prevent @click="recFor(s)"><i class="prd tw:flex-none tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-stop"></i>{{ s.w }}</button>
          <span v-if="recErr" class="ck-err tw:m-0 tw:text-down-fg tw:text-[12px]">{{ recErr }}</span>
        </template>
      </div>
      <p class="bp-vars tw:flex-[1_1_260px] tw:min-w-0 tw:m-0 tw:overflow-hidden tw:text-muted tw:text-[11.5px] tw:leading-[1.6] tw:text-ellipsis tw:whitespace-nowrap">Есть: <code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data">page</code><code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data">qa</code><code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data">context</code><code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data">expect</code><code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data" title="Генераторы значений: gen.text(255), gen.uuid(), gen.email(), gen.int(1, 100), gen.number(0, 10, 2), gen.date(-1), gen.pattern('AA-####'), gen.unique('тест'), gen.json({ … }), gen.oneOf(…)">gen</code><code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data">step(имя, fn)</code><code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data">set()</code><template v-if="vars.length"> · переменные заметки: <code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data" v-for="v in vars" :key="v">{{ v }}</code></template></p>
    </div>

    <Popover v-model:open="ckOpen" :anchor="ckBtn" :width="290" align-left :chrome="0" class="ck-pop tw:flex tw:flex-col tw:gap-2 tw:p-6 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:[.st.ok>&]:first:text-up-fg" :style="{ overflowY: 'auto' }">
        <button class="tw:group/g30 tw:flex tw:flex-col tw:items-start tw:gap-2 tw:py-7 tw:px-9 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text tw:text-left tw:hover:bg-hover" v-for="c in menuChecks" :key="c.id" :class="{ on: present.includes(c.id) }" :title="c.hint" @mousedown.prevent @click="addCheck(c.id)">
          <b class="tw:flex tw:items-center tw:gap-6 tw:w-full tw:font-medium tw:whitespace-nowrap tw:group-[.on]/g30:text-accent"><Icon v-if="present.includes(c.id)" name="check" :size="12" />{{ c.label }}<em class="tw:ml-auto tw:text-muted tw:not-italic tw:font-normal tw:text-[11px]" v-if="present.includes(c.id)">убрать</em></b>
        </button>
    </Popover>
    <!-- the ready checks: a verdict each, a table when there is one -->
    <div v-if="run?.checks?.length" class="qa-checks tw:flex tw:flex-col tw:gap-6 tw:my-6 tw:mx-0">
      <div v-for="(c, i) in run.checks" :key="i" class="qa-c tw:py-8 tw:px-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-up tw:rounded-[4px] tw:bg-panel-2" :class="c.state">
        <div class="qa-h tw:flex tw:items-center tw:gap-6 tw:[.qa-c.ok_&]:not-[.qa-c.fail_&]:not-[.qa-c.warn_&]:text-up-fg tw:[.qa-c.fail_&]:not-[.qa-c.warn_&]:text-down-fg tw:[.qa-c.warn_&]:text-warn-fg"><Icon :name="c.state === 'ok' ? 'check' : c.state === 'fail' ? 'x' : 'zap'" :size="13" /><b>{{ c.name }}</b><span class="tw:text-[11.5px] tw:opacity-85">{{ c.state === 'ok' ? 'прошла' : c.state === 'fail' ? 'не прошла' : 'внимание' }}</span></div>
        <p class="qa-s tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-text tw:text-[12.5px]">{{ c.summary }}</p>
        <table v-if="c.rows?.length" class="qa-t tw:group/qa-t tw:mt-6 tw:border-collapse tw:text-[12px] tw:[&.grp]:w-full" :class="{ grp: c.group }">
          <thead v-if="c.head"><tr><th class="tw:py-3 tw:px-8 tw:border tw:border-border tw:text-left tw:align-top tw:group-[.grp]/qa-t:whitespace-nowrap tw:whitespace-nowrap tw:bg-panel-3 tw:text-text-2 tw:font-semibold" v-for="(h, j) in c.head" :key="j">{{ h }}</th></tr></thead>
          <tbody>
            <tr class="tw:group/g31" v-for="(r, j) in c.rows" :key="j" :class="[c.marks?.[j], { first: c.group && (!j || c.rows[j - 1][0] !== r[0]) }]">
              <td class="tw:py-3 tw:px-8 tw:border tw:border-border tw:text-left tw:align-top tw:whitespace-pre-wrap tw:group-[.grp]/qa-t:border-t-transparent tw:group-[.grp]/qa-t:group-[.first]/g31:border-t-border-2 tw:group-[.grp]/qa-t:first:not-nth-4:whitespace-nowrap tw:group-[.grp]/qa-t:nth-4:whitespace-nowrap tw:group-[.grp]/qa-t:nth-2:not-nth-3:min-w-120 tw:group-[.grp]/qa-t:nth-3:min-w-140 tw:group-[.grp]/qa-t:nth-3:max-w-220 tw:group-[.grp]/qa-t:nth-3:wrap-anywhere tw:group-[.grp]/qa-t:last:w-[40%] tw:group-[.grp]/qa-t:first:font-semibold tw:[.qa-t_tr.warn_&]:not-first:not-[.qa-t_tr.fail_&]:bg-caution/10 tw:[.qa-t_tr.fail_&]:not-first:bg-stop/12 tw:[.qa-t_tr.warn_&]:nth-4:not-[.qa-t_tr.fail_&]:text-warn-fg tw:[.qa-t_tr.fail_&]:nth-4:text-down-fg" v-for="(x, k) in r" :key="k">{{ c.group && !k && j && c.rows[j - 1][0] === x ? '' : x }}</td>
            </tr>
          </tbody>
        </table>
        <!-- the screens: a picture each, the faults outlined; a click — bigger -->
        <div v-if="c.shots?.length" class="qa-shots tw:grid tw:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] tw:gap-6 tw:mt-8">
          <figure class="tw:m-0 tw:border tw:border-border tw:rounded-[4px] tw:overflow-hidden tw:cursor-zoom-in tw:bg-panel-3 tw:[&.bad]:border-down" v-for="sh in c.shots" :key="sh.file" :class="{ bad: sh.bad }" @click="bigShot = bigShot === sh.file ? undefined : sh.file">
            <img class="tw:block tw:w-full tw:h-90 tw:object-cover tw:object-[top_left]" v-if="shotUrls[sh.file]" :src="shotUrls[sh.file]" alt="" />
            <figcaption class="tw:flex tw:justify-between tw:py-2 tw:px-6 tw:font-data tw:text-[11px]">{{ sh.label }}<b class="tw:text-down-fg" v-if="sh.bad">{{ sh.bad }}</b></figcaption>
          </figure>
        </div>
        <img v-if="bigShot && c.shots?.some((x) => x.file === bigShot) && shotUrls[bigShot]" :src="shotUrls[bigShot]" class="qa-big tw:block tw:max-w-full tw:mt-8 tw:border tw:border-border-2 tw:rounded-[4px] tw:cursor-zoom-out" alt="" @click="bigShot = undefined" />
      </div>
    </div>
    <div v-if="run?.steps?.length" class="steps tw:flex tw:flex-col tw:py-4 tw:px-0 tw:border tw:border-border tw:rounded-[6px] tw:bg-bg">
      <div v-for="(s, i) in run.steps" :key="i" class="st tw:flex tw:items-center tw:gap-7 tw:min-w-0 tw:py-2 tw:px-8 tw:text-[12px] tw:[&.error]:text-down-fg" :class="s.state" :style="{ paddingLeft: `${8 + s.depth * 16}px` }" :title="s.error">
        <i v-if="s.state === 'run'" class="spin tw:w-10 tw:h-10 tw:border-2 tw:border-accent tw:[&&]:border-r-transparent tw:rounded-[50%] tw:animate-[BlockPw-spin_0.8s_linear_infinite]"></i>
        <Icon v-else :name="s.state === 'ok' ? 'check' : 'x'" :size="12" />
        <span class="sn tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ s.name }}</span>
        <span class="sm tw:flex-none tw:text-muted tw:font-data tw:text-[11px]">{{ msText(s.ms) }}</span>
      </div>
    </div>

    <div v-if="run && run.state !== 'run'" class="bp-out tw:flex tw:flex-col tw:gap-4">
      <div v-for="(l, i) in run.logs ?? []" :key="i" class="lg tw:py-1 tw:px-8 tw:border-l-2 tw:border-l-border-2 tw:text-text-2 tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word] tw:[&.error]:border-down tw:[&.error]:text-down-fg" :class="l.level">{{ l.text }}</div>
      <p v-if="run.error" class="er tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-down-fg tw:font-data tw:text-[12px] tw:whitespace-pre-wrap">{{ run.error }}</p>
      <div v-if="shot || hasTrace || hasAllure" class="arts tw:flex tw:items-start tw:gap-10 tw:mt-4 tw:[&:has(.shot.big)]:flex-col">
        <img v-if="shot" :src="shot" class="shot tw:flex-none tw:w-220 tw:border tw:border-border-2 tw:rounded-[6px] tw:cursor-zoom-in tw:[&.big]:w-[min(100%,900px)] tw:[&.big]:cursor-zoom-out" :class="{ big }" :title="big ? 'Свернуть' : 'Крупнее'" alt="" @click="big = !big" />
        <div class="abtn tw:flex tw:flex-wrap tw:items-center tw:gap-8">
          <span v-if="shot" class="muted tw:text-muted tw:text-[11.5px]">{{ shotName === 'failure.png' ? 'Страница в момент ошибки' : 'Страница в конце' }}</span>
          <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:text-[12px] tw:hover:border-accent" v-if="hasTrace" title="Каждое действие со снимком страницы, сеть, консоль — Playwright Trace Viewer во встроенном браузере" @mousedown.prevent @click="openTrace"><Icon name="timeline" :size="12" />Трассировка</button>
          <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:text-[12px] tw:hover:border-accent" v-if="hasAllure" title="Папка allure-results: allure serve / Allure TestOps" @mousedown.prevent @click="allure"><Icon name="folder" :size="12" />Allure</button>
          <span v-if="run.browser" class="muted tw:text-muted tw:text-[11.5px]">браузер {{ run.browser }}</span>
          <span v-if="traceErr" class="er tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-down-fg tw:font-data tw:text-[12px] tw:whitespace-pre-wrap">{{ traceErr }}</span>
        </div>
      </div>
      <template v-if="run.hasValue">
        <div class="vh tw:flex tw:items-center tw:gap-6 tw:mt-4 tw:text-[12px]">
          <button class="fold tw:inline-flex tw:w-22 tw:h-22 tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @mousedown.prevent @click="showValue = !showValue"><Icon name="chevronRight" :size="12" :style="showValue ? 'transform: rotate(90deg)' : ''" /></button>
          <b>Результат</b><span class="muted tw:text-muted tw:text-[11.5px]">{{ summary(run.value) }}</span>
          <span v-if="info.name" class="muted tw:text-muted tw:text-[11.5px]">→ {{ '{' }}{{ '{' }}{{ info.name }}{{ '}' }}{{ '}' }}</span>
        </div>
        <div v-if="showValue" class="bp-val"><ValueView :value="run.value" :name="info.name" /></div>
      </template>
    </div>
  </div>
</template>

<style scoped src="./BlockPw.css"></style>
