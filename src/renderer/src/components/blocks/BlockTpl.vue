<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { interpolate } from '@shared/runbook'
import { envAt, fenceParts, fenceSrc, noteRun, runKey } from '../../lib/runbook'
import { doc } from '../../lib/notebook'
import { useFold } from '../../lib/foldState'
import { copyMd } from '../../lib/copyMd'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'
import Markdown from '../Markdown.vue'
import RunHead from './RunHead.vue'

/**
 * «Текст по шаблону» (```md template name=…): Markdown — bold, lists, tables, emoji, quotes — with {{ values }} of the
 * note, filled as they are (nothing to run): shown as it reads, copied formatted (a chat, Jira, an e-mail) and as
 * text, published under its name. In a loop — filled on every pass: all the texts together under it.
 */
const props = defineProps<{ src: string; path: string; line: number; inLoop?: boolean; onChange?: (src: string) => void }>()
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
function write(info = fenceParts(mine).info, now = false): void {
  clearTimeout(timer)
  const go = () => {
    const p = fenceParts(mine)
    const src = fenceSrc(p.fence, info, body.value)
    if (src === mine) return
    mine = src
    props.onChange?.(src)
  }
  if (now) go()
  else timer = setTimeout(go, 300)
}
watch(body, () => write())
const rename = (name: string | undefined) => write({ ...fenceParts(mine).info, name }, true)
const key = computed(() => runKey(parts.value.info.name, 'tpl', props.line))

/** The text filled with the note's values now (what is missing — said, the text not published with holes). */
const filled = computed(() => {
  if (props.inLoop) return undefined
  // (follows the note's values: a block run again changes its time)
  const n = noteRun(props.path)
  for (const k in n.ctx) void n.ctx[k].at
  return interpolate(body.value, envAt(props.path, props.line, doc(props.path).text).values())
})
const missing = computed(() => [...new Set(filled.value?.missing ?? [])])
const missingText = computed(() => missing.value.map((m) => `{{${m}}}`).join(', '))
// (published under its name by the note itself, when whole — syncTemplates: the ones off screen too)
const open = useFold(() => `${props.path}#${key.value}#result`, true)
const copied = ref(false)
async function copy(): Promise<void> {
  if (!filled.value) return
  await copyMd(filled.value.text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="bt">
    <RunHead icon="note" kind="Шаблон" :name="parts.info.name" :can-run="false" name-placeholder="текст" @rename="rename" />
    <div class="bt-ed"><CodeArea v-model="body" lang="markdown" :min-height="40" placeholder="✅ **{{ user.body.data.email }}** — {{ rows[0].status }}" /></div>
    <div v-if="filled" class="bt-res">
      <div class="bt-rh">
        <button class="fold" :title="open ? 'Свернуть' : 'Показать'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <b>Текст</b>
        <span v-if="missing.length" class="warn" title="Выполните блоки, которые дают эти значения">нет значения: {{ missingText }}</span>
        <span v-else-if="parts.info.name" class="muted">→ {{ '{' }}{{ '{' }}{{ parts.info.name }}{{ '}' }}{{ '}' }}</span>
        <span class="grow"></span>
        <button class="ib" :title="copied ? 'Скопировано' : 'Копировать: с оформлением (чат, Jira, письмо) и как текст Markdown'" @mousedown.prevent @click="copy"><Icon :name="copied ? 'check' : 'copy'" :size="13" /></button>
      </div>
      <Markdown v-if="open" class="bt-md" :text="filled.text" />
    </div>
  </div>
</template>

<style scoped>
.bt {
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #34d399;
  border-radius: 8px;
  background: var(--panel);
}
.bt-ed :deep(.cm-editor) {
  max-height: 420px;
}
.bt-res {
  border: 1px solid var(--border-2);
  border-radius: 8px;
  background: var(--bg);
}
.bt-rh {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px 6px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
  white-space: nowrap;
}
.bt-md {
  padding: 6px 12px;
  user-select: text;
}
.muted {
  color: var(--muted);
}
.warn {
  overflow: hidden;
  color: var(--warn-fg);
  font-size: 12px;
  text-overflow: ellipsis;
}
.grow {
  flex: 1;
}
.fold,
.ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
