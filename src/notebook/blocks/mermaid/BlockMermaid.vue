<script setup lang="ts">
import { openUrl } from '@renderer/lib/links'
import { onBeforeUnmount, ref, watch } from 'vue'
import { mermaidBody, mermaidMd } from './model'
import Icon from '@renderer/components/Icon.vue'

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
  <div class="bm tw:group/bm tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel" :class="{ editing }">
    <div class="bm-h tw:flex tw:items-center tw:gap-10 tw:min-w-0">
      <span class="bm-k tw:inline-flex tw:items-center tw:gap-6 tw:text-muted tw:text-[12px]"><Icon name="branch" :size="13" />Диаграмма</span>
      <span v-if="error" class="bm-err tw:overflow-hidden tw:text-down-fg tw:text-[12px] tw:text-ellipsis tw:whitespace-nowrap" :title="error">{{ error }}</span>
      <span class="grow tw:flex-1"></span>
      <button class="lnk tw:h-24 tw:py-0 tw:px-6 tw:border-0 tw:bg-transparent tw:text-muted tw:text-[12px] tw:hover:text-text tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Справка по синтаксису Mermaid" @mousedown.prevent @click="window_open(HELP)">Синтаксис</button>
      <button class="bm-ed tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:border-accent/60 tw:[&.on]:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: editing }" @mousedown.prevent @click="editing = !editing"><Icon name="code" :size="13" />Код</button>
    </div>
    <div class="bm-b tw:grid tw:grid-cols-[minmax(0,1fr)] tw:gap-12 tw:group-[.editing]/bm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <textarea v-if="editing" :value="code" spellcheck="false" class="bm-code tw:min-h-160 tw:py-8 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:resize-y tw:field-sizing-content tw:outline-none tw:focus:border-accent" placeholder="flowchart LR&#10;  A --> B" @input="onCode(($event.target as HTMLTextAreaElement).value)"></textarea>
      <!-- eslint-disable-next-line vue/no-v-html — Mermaid's own SVG, made with securityLevel strict -->
      <div class="bm-svg tw:flex tw:justify-center tw:min-w-0 tw:overflow-x-auto" v-html="svg"></div>
    </div>
  </div>
</template>

<script lang="ts">
const window_open = (u: string) => openUrl(u)
</script>

<style scoped src="./BlockMermaid.css"></style>
