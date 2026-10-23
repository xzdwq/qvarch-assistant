<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { blockReport, envAt, fenceParts, fenceSrc, noteRun, pretty, runHttp, runKey, stopBlock } from '../../lib/runbook'
import { doc } from '../../lib/notebook'
import { useFold } from '../../lib/foldState'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'
import RunHead from './RunHead.vue'

/**
 * A request in a note (the .http format): run here, its answer shown under it and published into the note's
 * context under its name — {{login.body.token}} in the next block, in the text.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parts = computed(() => fenceParts(props.src))
const body = ref(parts.value.body)
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    body.value = fenceParts(s).body
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(timer)
  const go = () => {
    const p = fenceParts(mine)
    const src = fenceSrc(p.fence, p.info, body.value)
    if (src === mine) return
    mine = src
    props.onChange?.(src)
  }
  if (now) go()
  else timer = setTimeout(go, 300)
}
watch(body, () => save())
function rename(name: string | undefined): void {
  const p = fenceParts(mine)
  mine = fenceSrc(p.fence, { ...p.info, name }, body.value)
  props.onChange?.(mine)
}
const key = computed(() => runKey(parts.value.info.name, 'http', props.line))
const run = computed(() => noteRun(props.path).runs[key.value])
async function go(): Promise<void> {
  save(true)
  await runHttp(props.path, key.value, parts.value.info.name, body.value, envAt(props.path, props.line, doc(props.path).text))
}
const tab = ref<'body' | 'headers' | 'sent'>('body')
const shownBody = computed(() => {
  const b = run.value?.response?.body ?? ''
  try {
    return /^\s*[[{]/.test(b) ? pretty(JSON.parse(b)) : pretty(b)
  } catch {
    return pretty(b)
  }
})
const isJson = computed(() => /^\s*[[{]/.test(run.value?.response?.body ?? ''))
const statusCls = computed(() => {
  const s = run.value?.response?.status ?? 0
  return s >= 200 && s < 300 ? 'ok' : s >= 400 ? 'err' : 'warn'
})
const size = (n?: number) => (n === undefined ? '' : n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(2)} МБ`)
// (folded or open — as it was left, back from another tab too)
const open = useFold(() => `${props.path}#${key.value}#result`, true)
</script>

<template>
  <div class="bh" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="() => blockReport(path, key, 'http', parts.info, parts.body)" icon="api" kind="HTTP" :name="parts.info.name" :run="run" name-placeholder="ответ" @rename="rename" @run="go" @stop="stopBlock(path, key, envAt(path, line, doc(path).text).id)" />
    <div class="bh-ed"><CodeArea v-model="body" lang="http" :run="go" :min-height="40" placeholder="GET https://…   (заголовки строками, пустая строка, тело)" /></div>
    <p v-if="run?.request?.missing.length" class="bh-miss">Нет значения: <code v-for="m in run.request.missing" :key="m">{{ '{' }}{{ '{' }}{{ m }}{{ '}' }}{{ '}' }}</code> — выполните блок, который его даёт (или задайте переменную в разделе HTTP)</p>
    <div v-if="run && run.state !== 'run' && (run.response || run.error)" class="bh-res">
      <div class="bh-rh">
        <button class="fold" :title="open ? 'Свернуть ответ' : 'Показать ответ'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <template v-if="run.response">
          <b class="st" :class="statusCls">{{ run.response.status }} {{ run.response.statusText }}</b>
          <span class="mt">{{ run.response.time }} мс · {{ size(run.response.size) }}</span>
          <span class="tabs">
            <button :class="{ on: tab === 'body' }" @mousedown.prevent @click="tab = 'body'">Тело</button>
            <button :class="{ on: tab === 'headers' }" @mousedown.prevent @click="tab = 'headers'">Заголовки · {{ run.response.headers.length }}</button>
            <button :class="{ on: tab === 'sent' }" @mousedown.prevent @click="tab = 'sent'">Отправлено</button>
          </span>
        </template>
        <span v-if="run.error" class="er" :title="run.error">{{ run.error }}</span>
      </div>
      <template v-if="open && run.response">
        <div v-if="tab === 'body'" class="bh-out"><CodeArea :model-value="shownBody" :lang="isJson ? 'json' : 'text'" readonly :min-height="30" /></div>
        <table v-else-if="tab === 'headers'" class="hdrs">
          <tr v-for="([k, v], i) in run.response.headers" :key="i"><td>{{ k }}</td><td>{{ v }}</td></tr>
        </table>
        <pre v-else class="sent">{{ run.request?.method }} {{ run.request?.url }}
{{ run.request?.headers.map(([k, v]) => `${k}: ${v}`).join('\n') }}{{ run.request?.body ? `\n\n${run.request.body}` : '' }}</pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.bh {
  /* as wide as the note — long rows inside cut, never widen it */
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #38bdf8;
  border-radius: 8px;
  background: var(--panel);
}
.bh-ed :deep(.cm-editor),
.bh-out :deep(.cm-editor) {
  max-height: 360px;
}
.bh-out :deep(.cm-scroller) {
  overflow: auto;
}
.bh-miss {
  margin: 0;
  color: var(--warn-fg, #fbbf24);
  font-size: 12px;
}
.bh-miss code {
  margin: 0 3px;
  font-family: var(--font-data);
}
.bh-res {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bh-rh {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  white-space: nowrap;
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
.st {
  font-family: var(--font-data);
}
.st.ok {
  color: var(--up-fg);
}
.st.warn {
  color: var(--warn-fg, #fbbf24);
}
.st.err,
.er {
  color: var(--down-fg);
}
.er {
  overflow: hidden;
  text-overflow: ellipsis;
}
.mt {
  color: var(--muted);
  font-family: var(--font-data);
}
.tabs {
  display: inline-flex;
  gap: 2px;
  margin-left: auto;
}
.tabs button {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
}
.tabs button.on {
  background: var(--panel-3);
  color: var(--text);
}
.hdrs {
  border-collapse: collapse;
  font-family: var(--font-data);
  font-size: 12px;
}
.hdrs td {
  padding: 2px 10px 2px 0;
  vertical-align: top;
  word-break: break-all;
}
.hdrs td:first-child {
  color: var(--accent-fg);
  white-space: nowrap;
}
.sent {
  max-height: 260px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
