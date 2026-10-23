<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { blockReport, envAt, fenceParts, fenceSrc, noteRun, pretty, runKey, runPw, stopBlock } from '../../lib/runbook'
import { useFold } from '../../lib/foldState'
import { doc, save, setText } from '../../lib/notebook'
import { findBlocks } from '@shared/noteBlocks'
import { parseInfo } from '@shared/runbook'
import { summary, type BlockInfo, type PwBrowser } from '@shared/runbook'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'
import RunHead from './RunHead.vue'
import MatrixEditor from './MatrixEditor.vue'
import FuzzEditor from './FuzzEditor.vue'
import { readFuzz } from '@shared/fuzz'
import { pwRec, startPwRec, stopPwRec } from '../../lib/pwrec'
import { QA_CHECKS, checksFor, checksIn, fileSetOf, layoutModeOf, setFileSet, setLayoutMode, unwrapCheck, wrapCheck, type QaCheckKind } from '@shared/qaChecks'
import type { TestFileSet } from '@shared/testFiles'
import { placeFloat, useAnchor } from '../../lib/floating'

/**
 * A browser scenario in a note (Playwright): the installed Edge / Chrome, headless or with its window.
 * page / context / expect / step() / set() and the note's values; its steps go by while it runs; what it left:
 * a screenshot, the trace (Trace Viewer in the app's browser) and Allure results.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parts = computed(() => fenceParts(props.src))
const code = ref(parts.value.body)
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    code.value = fenceParts(s).body
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function write(info = fenceParts(mine).info): void {
  const p = fenceParts(mine)
  const src = fenceSrc(p.fence, info, code.value)
  if (src === mine) return
  mine = src
  props.onChange?.(src)
}
watch(code, () => {
  clearTimeout(timer)
  timer = setTimeout(() => write(), 300)
})
const info = computed(() => parts.value.info)
const ts = computed(() => info.value.lang.startsWith('t'))
const patch = (p: Partial<BlockInfo>) => write({ ...fenceParts(mine).info, ...p })
const key = computed(() => runKey(info.value.name, 'pw', props.line))
const run = computed(() => noteRun(props.path).runs[key.value])

// ---------- «Проверить ▾»: the recorded actions wrapped into a ready check ----------
const ckOpen = ref(false)
const ckBtn = ref<HTMLElement>()
const ckPop = ref<HTMLElement>()
const ckStyle = ref<Record<string, string>>({})
const ckErr = ref('')
// (the list fits the window: as high as there is room, scrolled beyond)
useAnchor(ckOpen, ckBtn, () => {
  if (!ckBtn.value) return
  const f = placeFloat(ckBtn.value, 290, true, 0)
  ckStyle.value = { ...f.style, maxHeight: `${f.maxH}px`, overflowY: 'auto' }
})
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
  clearTimeout(timer)
  write()
  const d = doc(props.path)
  const lines = d.text.split('\n')
  const me = findBlocks(lines).find((b) => b.kind === 'pw' && b.line0 === props.line)
  if (!me) return
  const taken = new Set(findBlocks(lines).map((b) => parseInfo(b.src.split('\n')[0].replace(/^(`{3,}|~{3,})/, '')).name))
  let name = `${info.value.name || 'сценарий'}-${s.w}`
  for (let n = 2; taken.has(name); n++) name = `${info.value.name || 'сценарий'}-${s.w}-${n}`
  lines.splice(me.line1, 0, '', `\`\`\`ts playwright name=${name} session timeout=300`, '```')
  setText(props.path, lines.join('\n'))
  await save(props.path)
  try {
    await startPwRec(props.path, runKey(name, 'pw', me.line1 + 2), url, {
      screen: { w: s.w, h: s.h },
      tail: [`await qa.layout({ widths: [${s.w}], zooms: [80, 100, 125] }) // шаг: Вёрстка на экране ${s.w} px`],
    })
  } catch (e) {
    recErr.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
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
  const r = wrapCheck(code.value, k)
  if ('error' in r) return void (ckErr.value = r.error)
  code.value = r.code
  ckErr.value = ''
  ckOpen.value = false
  // hundreds of actions — the block may take its time (15 min at most, unless more is set)
  if (k === 'load' && (info.value.timeout ?? 0) < 900) patch({ timeout: 900 })
  // the layout check — a dozen screens: a few minutes
  else if (k === 'layout' && (info.value.timeout ?? 0) < 300) patch({ timeout: 300 })
  // the matrix — the scenario a few dozen times
  else if (k === 'matrix' && (info.value.timeout ?? 0) < 1200) patch({ timeout: 1200 })
  // a file per run — an import each: time for every one
  else if (k === 'files' && (info.value.timeout ?? 0) < 1200) patch({ timeout: 1200 })
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
const ckAway = (e: PointerEvent) => {
  const t = e.target as Node
  if (ckOpen.value && !ckBtn.value?.contains(t) && !ckPop.value?.contains(t)) ckOpen.value = false
}
window.addEventListener('pointerdown', ckAway, true)
onBeforeUnmount(() => window.removeEventListener('pointerdown', ckAway, true))
async function go(): Promise<void> {
  clearTimeout(timer)
  write()
  await runPw(props.path, key.value, fenceParts(mine).info, code.value, doc(props.path).text, envAt(props.path, props.line, doc(props.path).text))
}
const BROWSERS: Array<{ id: PwBrowser; label: string; title: string }> = [
  { id: 'msedge', label: 'Edge', title: 'Microsoft Edge, установленный в системе' },
  { id: 'chrome', label: 'Chrome', title: 'Google Chrome, установленный в системе' },
]
const vars = computed(() => Object.keys(envAt(props.path, props.line, doc(props.path).text).values()))
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
    traceErr.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
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
    clearTimeout(timer)
    write()
    await startPwRec(props.path, key.value, url)
    recUrl.value = undefined
  } catch (e) {
    recErr.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  }
}
const allure = () => window.qa.pwAllure(props.path, key.value)
const msText = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`)
</script>

<template>
  <div class="bp" @keydown.ctrl.enter.prevent="go">
    <RunHead :report="() => blockReport(path, key, 'pw', info, code)" icon="globe" kind="Playwright" :name="info.name" :run="run" can-run name-placeholder="сценарий" @rename="(name) => patch({ name })" @run="go" @stop="stopBlock(path, key)">
      <span class="seg">
        <button :class="{ on: !ts }" @mousedown.prevent @click="patch({ lang: 'js' })">JS</button>
        <button :class="{ on: ts }" title="TypeScript: типы просто убираются перед выполнением" @mousedown.prevent @click="patch({ lang: 'ts' })">TS</button>
      </span>
    </RunHead>
    <div v-if="recording" class="recon"><i class="prd"></i>Идёт запись в Браузере · строк: {{ pwRec!.count }}<span class="grow"></span><button @mousedown.prevent @click="stopPwRec()">Стоп — вставить сюда</button><button @mousedown.prevent @click="stopPwRec(true)">Отменить</button></div>
    <div v-else-if="recUrl !== undefined" class="recon ask">
      <i class="prd"></i><span>С какой страницы начать:</span>
      <input v-model="recUrl" spellcheck="false" placeholder="https://…" @keydown.enter.prevent="rec" @keydown.esc.prevent="recUrl = undefined" />
      <button class="go" @mousedown.prevent @click="rec">Записать</button><button @mousedown.prevent @click="recUrl = undefined">Отмена</button>
      <span v-if="recErr" class="er">{{ recErr }}</span>
    </div>
    <div class="bp-ed"><CodeArea v-model="code" :lang="ts ? 'typescript' : 'js'" :min-height="40" placeholder="await page.goto('https://…')" /></div>
    <div class="bp-opts">
      <span class="seg">
        <button v-for="b in BROWSERS" :key="b.id" :class="{ on: (info.browser ?? 'msedge') === b.id }" :title="b.title" @mousedown.prevent @click="patch({ browser: b.id })">{{ b.label }}</button>
      </span>
      <label class="chk" title="Показывать окно браузера во время выполнения (иначе — без окна)"><input type="checkbox" :checked="info.headed" @change="patch({ headed: ($event.target as HTMLInputElement).checked })" />окно</label>
      <label class="chk" title="Записывать трассировку (Trace Viewer): каждое действие со снимком страницы, сеть, консоль"><input type="checkbox" :checked="!info.notrace" @change="patch({ notrace: !($event.target as HTMLInputElement).checked })" />трассировка</label>
        <label class="chk" title="Войти как в разделе «Браузер»: тест получает его cookies — сайт, на который вы вошли там (в том числе через ADFS), открывается уже с входом"><input type="checkbox" :checked="info.session" @change="patch({ session: ($event.target as HTMLInputElement).checked })" />вход из Браузера</label>
        <button class="recb" title="Записать сценарий: откроется Браузер, ваши клики и ввод станут строками теста; «Стоп» вернёт сюда" @mousedown.prevent @click="askRec"><i class="prd"></i>Записать</button>
        <button ref="ckBtn" class="ckb" :class="{ on: ckOpen }" title="Обернуть записанные действия в готовую проверку" @mousedown.prevent @click="(ckOpen = !ckOpen), (ckErr = '')"><Icon name="checkSquare" :size="12" />Проверить<Icon name="chevronDown" :size="10" /></button>
        <label class="chk" title="Ошибка этого сценария не останавливает «Выполнить всё» (ожидаемое падение, нестабильный тест)"><input type="checkbox" :checked="info.soft" @change="patch({ soft: ($event.target as HTMLInputElement).checked })" />не останавливать</label>
      <p v-if="ckErr" class="ck-err">{{ ckErr }}</p>
      <p v-if="present.length" class="ck-on" title="Проверки выполняются в этом порядке — по строкам сценария">
        <span class="muted">В сценарии:</span>
        <template v-for="(k, i) in present" :key="i"
          ><Icon v-if="i" name="chevronRight" :size="10" class="muted" /><span class="ck-chip"><Icon name="checkSquare" :size="11" />{{ labelOf(k) }}<button title="Убрать проверку из сценария" @mousedown.prevent @click="dropCheck(k)"><Icon name="x" :size="10" /></button></span></template
        >
        <button v-if="present.includes('matrix')" class="mx-btn" :class="{ on: mxOpen }" title="Свои значения для полей: строки нужной длины, UUID, e-mail, числа, даты, JSON-объекты…" @mousedown.prevent @click="mxOpen = !mxOpen">
          <Icon name="settings" :size="11" />Значения матрицы
        </button>
        <button v-if="present.includes('fuzz')" class="mx-btn" :class="{ on: fzOpen }" title="Какой запрос, какие параметры и какими значениями перебирать" @mousedown.prevent @click="fzOpen = !fzOpen">
          <Icon name="settings" :size="11" />Параметры перебора
        </button>
      </p>
      <MatrixEditor v-if="mxOpen && present.includes('matrix')" :code="code" @update="(c) => (code = c)" />
      <FuzzEditor v-if="fzOpen && present.includes('fuzz')" :code="code" @update="(c) => (code = c)" />
      <div v-if="present.includes('files')" class="lay-mode">
        <span class="muted">Файлы из набора:</span>
        <select :value="fileSet" title="Сценарий пройдёт по разу с каждым файлом этого набора («Тестовые файлы»)" @focus="loadSets" @change="code = setFileSet(code, ($event.target as HTMLSelectElement).value)">
          <option v-if="!fileSets.some((s) => s.name === fileSet)" :value="fileSet">{{ fileSet }}</option>
          <option v-for="s in fileSets" :key="s.name" :value="s.name">{{ s.name }} · {{ s.count }}</option>
        </select>
      </div>
      <div v-if="present.includes('layout')" class="lay-mode">
        <span class="muted">Вёрстка:</span>
        <span class="seg">
          <button :class="{ on: lmode === 'here' }" title="Страница там, где стоит строка проверки, — на всех экранах и масштабах. Действия идут на записанном размере" @mousedown.prevent @click="setLMode('here')">на этой странице</button>
          <button :class="{ on: lmode === 'each' }" title="Весь сценарий заново на 375 / 768 / 1280 / 1920 px: где не прошёл (кнопка ушла в меню) — сказано, со снимком; где прошёл — вёрстка в конце. Сценарий, создающий данные, создаст их на каждом экране" @mousedown.prevent @click="setLMode('each')">весь сценарий на каждом экране</button>
          <button :class="{ on: lmode === 'record' }" title="Отдельный сценарий для узкого экрана (когда путь там другой: меню, боковая панель): запись в Браузере сразу этого размера, вёрстка в конце" @mousedown.prevent @click="setLMode('record')">свой сценарий для экрана</button>
        </span>
        <template v-if="lmode === 'record'">
          <button v-for="s in SCREENS" :key="s.w" class="scr" :disabled="!!pwRec" :title="`Новый блок под этим: запись в Браузере на экране ${s.w}×${s.h} (${s.label}), в конце — вёрстка на этом экране`" @mousedown.prevent @click="recFor(s)"><i class="prd"></i>{{ s.w }}</button>
          <span v-if="recErr" class="ck-err">{{ recErr }}</span>
        </template>
      </div>
      <p class="bp-vars">Есть: <code>page</code><code>qa</code><code>context</code><code>expect</code><code title="Генераторы значений: gen.text(255), gen.uuid(), gen.email(), gen.int(1, 100), gen.number(0, 10, 2), gen.date(-1), gen.pattern('AA-####'), gen.unique('тест'), gen.json({ … }), gen.oneOf(…)">gen</code><code>step(имя, fn)</code><code>set()</code><template v-if="vars.length"> · переменные заметки: <code v-for="v in vars" :key="v">{{ v }}</code></template></p>
    </div>

    <Teleport to="body">
      <div v-if="ckOpen" ref="ckPop" class="ck-pop" :style="ckStyle">
        <button v-for="c in menuChecks" :key="c.id" :class="{ on: present.includes(c.id) }" :title="c.hint" @mousedown.prevent @click="addCheck(c.id)">
          <b><Icon v-if="present.includes(c.id)" name="check" :size="12" />{{ c.label }}<em v-if="present.includes(c.id)">убрать</em></b>
        </button>
      </div>
    </Teleport>
    <!-- the ready checks: a verdict each, a table when there is one -->
    <div v-if="run?.checks?.length" class="qa-checks">
      <div v-for="(c, i) in run.checks" :key="i" class="qa-c" :class="c.state">
        <div class="qa-h"><Icon :name="c.state === 'ok' ? 'check' : c.state === 'fail' ? 'x' : 'zap'" :size="13" /><b>{{ c.name }}</b><span>{{ c.state === 'ok' ? 'прошла' : c.state === 'fail' ? 'не прошла' : 'внимание' }}</span></div>
        <p class="qa-s">{{ c.summary }}</p>
        <table v-if="c.rows?.length" class="qa-t" :class="{ grp: c.group }">
          <thead v-if="c.head"><tr><th v-for="(h, j) in c.head" :key="j">{{ h }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, j) in c.rows" :key="j" :class="[c.marks?.[j], { first: c.group && (!j || c.rows[j - 1][0] !== r[0]) }]">
              <td v-for="(x, k) in r" :key="k">{{ c.group && !k && j && c.rows[j - 1][0] === x ? '' : x }}</td>
            </tr>
          </tbody>
        </table>
        <!-- the screens: a picture each, the faults outlined; a click — bigger -->
        <div v-if="c.shots?.length" class="qa-shots">
          <figure v-for="sh in c.shots" :key="sh.file" :class="{ bad: sh.bad }" @click="bigShot = bigShot === sh.file ? undefined : sh.file">
            <img v-if="shotUrls[sh.file]" :src="shotUrls[sh.file]" alt="" />
            <figcaption>{{ sh.label }}<b v-if="sh.bad">{{ sh.bad }}</b></figcaption>
          </figure>
        </div>
        <img v-if="bigShot && c.shots?.some((x) => x.file === bigShot) && shotUrls[bigShot]" :src="shotUrls[bigShot]" class="qa-big" alt="" @click="bigShot = undefined" />
      </div>
    </div>
    <div v-if="run?.steps?.length" class="steps">
      <div v-for="(s, i) in run.steps" :key="i" class="st" :class="s.state" :style="{ paddingLeft: `${8 + s.depth * 16}px` }" :title="s.error">
        <i v-if="s.state === 'run'" class="spin"></i>
        <Icon v-else :name="s.state === 'ok' ? 'check' : 'x'" :size="12" />
        <span class="sn">{{ s.name }}</span>
        <span class="sm">{{ msText(s.ms) }}</span>
      </div>
    </div>

    <div v-if="run && run.state !== 'run'" class="bp-out">
      <div v-for="(l, i) in run.logs ?? []" :key="i" class="lg" :class="l.level">{{ l.text }}</div>
      <p v-if="run.error" class="er">{{ run.error }}</p>
      <div v-if="shot || hasTrace || hasAllure" class="arts">
        <img v-if="shot" :src="shot" class="shot" :class="{ big }" :title="big ? 'Свернуть' : 'Крупнее'" alt="" @click="big = !big" />
        <div class="abtn">
          <span v-if="shot" class="muted">{{ shotName === 'failure.png' ? 'Страница в момент ошибки' : 'Страница в конце' }}</span>
          <button v-if="hasTrace" title="Каждое действие со снимком страницы, сеть, консоль — Playwright Trace Viewer во встроенном браузере" @mousedown.prevent @click="openTrace"><Icon name="timeline" :size="12" />Трассировка</button>
          <button v-if="hasAllure" title="Папка allure-results: allure serve / Allure TestOps" @mousedown.prevent @click="allure"><Icon name="folder" :size="12" />Allure</button>
          <span v-if="run.browser" class="muted">браузер {{ run.browser }}</span>
          <span v-if="traceErr" class="er">{{ traceErr }}</span>
        </div>
      </div>
      <template v-if="run.hasValue">
        <div class="vh">
          <button class="fold" @mousedown.prevent @click="showValue = !showValue"><Icon name="chevronRight" :size="12" :style="showValue ? 'transform: rotate(90deg)' : ''" /></button>
          <b>Результат</b><span class="muted">{{ summary(run.value) }}</span>
          <span v-if="info.name" class="muted">→ {{ '{' }}{{ '{' }}{{ info.name }}{{ '}' }}{{ '}' }}</span>
        </div>
        <div v-if="showValue" class="bp-val"><CodeArea :model-value="pretty(run.value)" :lang="typeof run.value === 'object' ? 'json' : 'text'" readonly :min-height="24" /></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.bp {
  /* as wide as the note — long rows inside cut, never widen it */
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #2dd4bf;
  border-radius: 8px;
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
.chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  white-space: nowrap;
}
.bp-ed :deep(.cm-editor),
.bp-val :deep(.cm-editor) {
  max-height: 420px;
}
.ckb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
}
.ckb.on {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--accent-fg);
}
.ck-err {
  margin: 0;
  color: var(--down-fg);
  font-size: 12px;
}
.ck-pop {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.ck-pop button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
}
.ck-pop button:hover {
  background: var(--hover);
}
.ck-pop small {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.4;
}
.ck-pop b {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font-weight: 500;
  white-space: nowrap;
}
.ck-pop button.on b {
  color: var(--accent);
}
.ck-pop b em {
  margin-left: auto;
  color: var(--muted);
  font-style: normal;
  font-weight: 400;
  font-size: 11px;
}
.ck-on {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin: 0;
  font-size: 12px;
}
.ck-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 2px 0 7px;
  border: 1px solid rgb(var(--accent-rgb) / 0.4);
  border-radius: 11px;
  background: rgb(var(--accent-rgb) / 0.1);
  white-space: nowrap;
}
.lay-mode {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.lay-mode .seg button {
  white-space: nowrap;
}
.lay-mode .scr {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  font-family: var(--font-data);
}
.mx-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  margin-left: 4px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-radius: 11px;
  background: transparent;
  color: var(--text-2);
  white-space: nowrap;
}
.mx-btn.on,
.mx-btn:hover {
  border-color: var(--accent);
  color: var(--text);
}
.ck-chip button {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
}
.ck-chip button:hover {
  background: var(--hover);
  color: var(--text);
}
.qa-checks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0;
}
.qa-c {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--up);
  border-radius: 4px;
  background: var(--panel-2);
}
.qa-c.fail {
  border-left-color: var(--down);
}
.qa-c.warn {
  border-left-color: var(--warn);
}
.qa-h {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qa-c.ok .qa-h {
  color: var(--up-fg);
}
.qa-c.fail .qa-h {
  color: var(--down-fg);
}
.qa-c.warn .qa-h {
  color: var(--warn-fg);
}
.qa-h span {
  font-size: 11.5px;
  opacity: 0.85;
}
.qa-s {
  margin: 4px 0 0;
  color: var(--text);
  font-size: 12.5px;
}
.qa-shots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 6px;
  margin-top: 8px;
}
.qa-shots figure {
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  cursor: zoom-in;
  background: var(--panel-3);
}
.qa-shots figure.bad {
  border-color: var(--down);
}
.qa-shots img {
  display: block;
  width: 100%;
  height: 90px;
  object-fit: cover;
  object-position: top left;
}
.qa-shots figcaption {
  display: flex;
  justify-content: space-between;
  padding: 2px 6px;
  font-family: var(--font-data);
  font-size: 11px;
}
.qa-shots figcaption b {
  color: var(--down-fg);
}
.qa-big {
  display: block;
  max-width: 100%;
  margin-top: 8px;
  border: 1px solid var(--border-2);
  border-radius: 4px;
  cursor: zoom-out;
}
.qa-t {
  margin-top: 6px;
  border-collapse: collapse;
  font-size: 12px;
}
.qa-t th,
.qa-t td {
  padding: 3px 8px;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
}
/* in groups (the field matrix): the group's name once, its rows marked by their verdict */
.qa-t.grp td {
  border-top-color: transparent;
}
.qa-t.grp tr.first td {
  border-top-color: var(--border-2);
}
.qa-t.grp {
  width: 100%;
}
.qa-t.grp th,
.qa-t.grp td:first-child,
.qa-t.grp td:nth-child(4) {
  white-space: nowrap;
}
.qa-t.grp td:nth-child(2) {
  min-width: 120px;
}
.qa-t.grp td:nth-child(3) {
  min-width: 140px;
  max-width: 220px;
  overflow-wrap: anywhere;
}
.qa-t.grp td:last-child {
  width: 40%;
}
.qa-t.grp td:first-child {
  font-weight: 600;
}
.qa-t tr.warn td:not(:first-child) {
  background: rgb(var(--warn-rgb, 251 191 36) / 0.1);
}
.qa-t tr.fail td:not(:first-child) {
  background: rgb(239 68 68 / 0.12);
}
.qa-t tr.warn td:nth-child(4) {
  color: var(--warn-fg);
}
.qa-t tr.fail td:nth-child(4) {
  color: var(--down-fg);
}
.qa-t th {
  white-space: nowrap;
  background: var(--panel-3);
  color: var(--text-2);
  font-weight: 600;
}
.recb {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 11.5px;
}
.recb:hover {
  background: rgba(239, 68, 68, 0.12);
}
.prd {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
}
.recon {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.08);
  font-size: 12px;
}
.recon .prd {
  animation: prblink 1.2s ease-in-out infinite;
}
@keyframes prblink {
  50% {
    opacity: 0.35;
  }
}
.recon input {
  flex: 1;
  min-width: 120px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
}
.recon button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
}
.recon button.go {
  border-color: #ef4444;
  background: #ef4444;
  color: #fff;
}
.grow {
  flex: 1;
}
.bp-opts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-width: 0;
}
.bp-vars {
  flex: 1 1 260px;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.6;
  /* one line: narrow — cut at its end (the names are the editor's completion too) */
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-vars code {
  margin: 0 3px;
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.muted {
  color: var(--muted);
  font-size: 11.5px;
}
.steps {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.st {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 2px 8px;
  font-size: 12px;
}
.st.ok > :first-child {
  color: var(--up-fg, #4ade80);
}
.st.error {
  color: var(--down-fg);
}
.sn {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm {
  flex: none;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.spin {
  width: 10px;
  height: 10px;
  border: 2px solid var(--accent);
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.bp-out {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lg {
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
  color: #fde68a;
}
.lg.error {
  border-color: var(--down);
  color: var(--down-fg);
}
.er {
  margin: 4px 0 0;
  color: var(--down-fg);
  font-family: var(--font-data);
  font-size: 12px;
  white-space: pre-wrap;
}
.arts {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 4px;
}
.shot {
  flex: none;
  width: 220px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  cursor: zoom-in;
}
.shot.big {
  width: min(100%, 900px);
  cursor: zoom-out;
}
.arts:has(.shot.big) {
  flex-direction: column;
}
.abtn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.abtn button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
}
.abtn button:hover {
  border-color: var(--accent);
}
.vh {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
}
.fold {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
</style>
