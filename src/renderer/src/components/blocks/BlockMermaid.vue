<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { mermaidBody, mermaidMd } from '@shared/noteBlocks'
import Icon from '../Icon.vue'

/**
 * A diagram (Mermaid): flowcharts, sequences, states, ER, Gantt… drawn from its text. «Код» opens the text
 * next to the picture — it redraws as you type; a broken text keeps the last good picture and says why.
 */
const props = defineProps<{ src: string; autofocus?: boolean }>()
const emit = defineEmits<{ change: [src: string] }>()
const code = ref(mermaidBody(props.src))
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    code.value = mermaidBody(s)
  },
)
const editing = ref(!!props.autofocus)
const svg = ref('')
const error = ref('')
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
async function draw(): Promise<void> {
  const my = ++seq
  try {
    const { default: mermaid } = await import('mermaid')
    const dark = !document.documentElement.classList.contains('light')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'Inter Variable, sans-serif' })
    const { svg: out } = await mermaid.render(`qa-mmd-${Date.now()}-${my}`, code.value || 'flowchart LR\n  A')
    if (my !== seq) return
    svg.value = out
    error.value = ''
  } catch (e) {
    if (my !== seq) return
    error.value = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 3).join(' ')
    // mermaid leaves its error picture in <body>
    document.querySelectorAll('body > [id^="dqa-mmd-"]').forEach((n) => n.remove())
  }
}
watch(
  code,
  () => {
    clearTimeout(timer)
    timer = setTimeout(draw, 300)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))
let saveTimer: ReturnType<typeof setTimeout> | undefined
function onCode(v: string): void {
  code.value = v
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const md = mermaidMd(code.value)
    if (md !== mine) {
      mine = md
      emit('change', md)
    }
  }, 400)
}
const HELP = 'https://mermaid.js.org/intro/syntax-reference.html'
</script>

<template>
  <div class="bm" :class="{ editing }">
    <div class="bm-h">
      <span class="bm-k"><Icon name="branch" :size="13" />Диаграмма</span>
      <span v-if="error" class="bm-err" :title="error">{{ error }}</span>
      <span class="grow"></span>
      <button class="lnk" title="Справка по синтаксису Mermaid" @mousedown.prevent @click="window_open(HELP)">Синтаксис</button>
      <button class="bm-ed" :class="{ on: editing }" @mousedown.prevent @click="editing = !editing"><Icon name="code" :size="13" />Код</button>
    </div>
    <div class="bm-b">
      <textarea v-if="editing" :value="code" spellcheck="false" class="bm-code" placeholder="flowchart LR&#10;  A --> B" @input="onCode(($event.target as HTMLTextAreaElement).value)"></textarea>
      <!-- eslint-disable-next-line vue/no-v-html — Mermaid's own SVG, made with securityLevel strict -->
      <div class="bm-svg" v-html="svg"></div>
    </div>
  </div>
</template>

<script lang="ts">
const window_open = (u: string) => window.qa.openExternal(u)
</script>

<style scoped>
.bm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.bm-h {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.bm-k {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}
.bm-err {
  overflow: hidden;
  color: var(--down-fg);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grow {
  flex: 1;
}
.lnk {
  height: 24px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.lnk:hover {
  color: var(--text);
}
.bm-ed {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.bm-ed.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  color: var(--accent-fg);
}
.bm-b {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}
.editing .bm-b {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
}
.bm-code {
  min-height: 160px;
  padding: 8px 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
  field-sizing: content;
  outline: none;
}
.bm-code:focus {
  border-color: var(--accent);
}
.bm-svg {
  display: flex;
  justify-content: center;
  min-width: 0;
  overflow-x: auto;
}
.bm-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}
</style>
