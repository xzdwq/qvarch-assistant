<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { blockReport, envAt, fenceParts, fenceSrc, noteRun, pretty, runCode, runKey, stopBlock } from '../../lib/runbook'
import { useFold } from '../../lib/foldState'
import { doc } from '../../lib/notebook'
import { summary } from '@shared/runbook'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'
import RunHead from './RunHead.vue'

/**
 * Code in a note (JS, or TS — the types are cut away): run apart from the app (stopped at once, its memory
 * capped). The note's context values are its variables; what it returns is published under its name.
 * «Общие функции» (lib): not run alone — put before every code block of the note.
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
const setLang = (l: 'js' | 'ts') => write({ ...fenceParts(mine).info, lang: l })
const setLib = (lib: boolean) => write({ ...fenceParts(mine).info, lib, run: !lib })
const rename = (name: string | undefined) => write({ ...fenceParts(mine).info, name })
const key = computed(() => runKey(info.value.name, 'code', props.line))
const run = computed(() => noteRun(props.path).runs[key.value])
async function go(): Promise<void> {
  clearTimeout(timer)
  write()
  if (info.value.lib) return
  await runCode(props.path, key.value, info.value.name, info.value.lang, code.value, doc(props.path).text, info.value.timeout, envAt(props.path, props.line, doc(props.path).text))
}
const vars = computed(() => Object.keys(envAt(props.path, props.line, doc(props.path).text).values()))
// (folded or open — as it was left, back from another tab too)
const showValue = useFold(() => `${props.path}#${key.value}#result`, true)
</script>

<template>
  <div class="bc" :class="{ lib: info.lib }" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="() => blockReport(path, key, 'code', info, code)" :icon="info.lib ? 'book' : 'code'" :kind="info.lib ? 'Общие функции' : 'Код'" :name="info.name" :run="info.lib ? undefined : run" :can-run="!info.lib" name-placeholder="результат" @rename="rename" @run="go" @stop="stopBlock(path, key, envAt(path, line, doc(path).text).id)">
      <span class="seg">
        <button :class="{ on: !ts }" @mousedown.prevent @click="setLang('js')">JS</button>
        <button :class="{ on: ts }" title="TypeScript: типы просто убираются перед выполнением" @mousedown.prevent @click="setLang('ts')">TS</button>
      </span>
      <label class="chk" title="Общие функции: не выполняются сами, подставляются перед каждым блоком кода заметки"><input type="checkbox" :checked="info.lib" @change="setLib(($event.target as HTMLInputElement).checked)" />lib</label>
    </RunHead>
    <div class="bc-ed"><CodeArea v-model="code" :lang="ts ? 'typescript' : 'js'" :run="go" :min-height="40" placeholder="return items.filter((x) => x.price > 100)" /></div>
    <p v-if="!info.lib && vars.length" class="bc-vars">Доступно: <code v-for="v in vars" :key="v">{{ v }}</code><span class="muted">· set('имя', значение) — опубликовать ещё</span></p>
    <div v-if="run && !info.lib && run.state !== 'run'" class="bc-out">
      <div v-for="(l, i) in run.logs ?? []" :key="i" class="lg" :class="l.level">{{ l.text }}</div>
      <p v-if="run.error" class="er">{{ run.error }}</p>
      <template v-else-if="run.hasValue">
        <div class="vh">
          <button class="fold" @mousedown.prevent @click="showValue = !showValue"><Icon name="chevronRight" :size="12" :style="showValue ? 'transform: rotate(90deg)' : ''" /></button>
          <b>Результат</b><span class="muted">{{ summary(run.value) }}</span>
          <span v-if="info.name" class="muted">→ {{ '{' }}{{ '{' }}{{ info.name }}{{ '}' }}{{ '}' }}</span>
        </div>
        <div v-if="showValue" class="bc-val"><CodeArea :model-value="pretty(run.value)" :lang="typeof run.value === 'object' ? 'json' : 'text'" readonly :min-height="24" /></div>
      </template>
      <p v-else-if="!run.logs?.length" class="muted">Выполнено. Ничего не вернул — добавьте return, чтобы опубликовать результат.</p>
    </div>
  </div>
</template>

<style scoped>
.bc {
  /* as wide as the note — long rows inside cut, never widen it */
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #a78bfa;
  border-radius: 8px;
  background: var(--panel);
}
.bc.lib {
  border-left-color: var(--border-3);
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
}
.bc-ed :deep(.cm-editor),
.bc-val :deep(.cm-editor) {
  max-height: 420px;
}
.bc-vars {
  margin: 0;
  color: var(--muted);
  font-size: 11.5px;
}
.bc-vars code {
  margin: 0 3px;
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.muted {
  margin-left: 6px;
  color: var(--muted);
  font-size: 11.5px;
}
.bc-out {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
.vh {
  display: flex;
  align-items: center;
  gap: 4px;
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
