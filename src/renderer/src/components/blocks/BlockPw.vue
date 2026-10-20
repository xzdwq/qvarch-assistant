<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { blockReport, fenceParts, fenceSrc, noteRun, pretty, runKey, runPw, stopBlock } from '../../lib/runbook'
import { doc } from '../../lib/notebook'
import { summary, type BlockInfo, type PwBrowser } from '@shared/runbook'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'
import RunHead from './RunHead.vue'
import { pwRec, startPwRec, stopPwRec } from '../../lib/pwrec'

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
async function go(): Promise<void> {
  clearTimeout(timer)
  write()
  await runPw(props.path, key.value, fenceParts(mine).info, code.value, doc(props.path).text)
}
const BROWSERS: Array<{ id: PwBrowser; label: string; title: string }> = [
  { id: 'msedge', label: 'Edge', title: 'Microsoft Edge, установленный в системе' },
  { id: 'chrome', label: 'Chrome', title: 'Google Chrome, установленный в системе' },
]
const vars = computed(() => Object.keys(noteRun(props.path).ctx))
const showValue = ref(false)

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
        <label class="chk" title="Ошибка этого сценария не останавливает «Выполнить всё» (ожидаемое падение, нестабильный тест)"><input type="checkbox" :checked="info.soft" @change="patch({ soft: ($event.target as HTMLInputElement).checked })" />не останавливать</label>
      <p class="bp-vars">Есть: <code>page</code><code>context</code><code>expect</code><code>step(имя, fn)</code><code>set()</code><template v-if="vars.length"> · переменные заметки: <code v-for="v in vars" :key="v">{{ v }}</code></template></p>
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
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.6;
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
