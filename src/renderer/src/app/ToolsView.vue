<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import Icon from '../components/Icon.vue'
import PdfSignView from './PdfSignView.vue'
import DiffTool from '../components/tools/DiffTool.vue'
import CodecTool from '../components/tools/CodecTool.vue'
import ClipTool from '../components/tools/ClipTool.vue'
import CronTool from '../components/tools/CronTool.vue'
import RegexTool from '../components/tools/RegexTool.vue'
import YamlTool from '../components/tools/YamlTool.vue'
import TimestampTool from '../components/tools/TimestampTool.vue'

/**
 * Инструменты: a side list of tools (its width dragged; folded down to the icons) and the one picked —
 * comparing two texts, encodings (JWT, UUID, Base64, hashes), JSON ↔ YAML, regular expressions, timestamps,
 * cron expressions, the clipboard's history, signing a PDF.
 */
/** The tools in the side list's order: each with its screen. */
const TOOLS = [
  { id: 'diff', icon: 'diff', label: 'Сравнение текстов', hint: 'Два текста или JSON: что изменилось', view: DiffTool },
  { id: 'codec', icon: 'binary', label: 'Кодировки', hint: 'JWT, UUID, Base64 (и изображения), хэши MD5 / SHA', view: CodecTool },
  { id: 'yaml', icon: 'braces', label: 'JSON ↔ YAML', hint: 'Перевод в обе стороны и форматирование', view: YamlTool },
  { id: 'regex', icon: 'regex', label: 'Регулярные выражения', hint: 'Проверка, группы, замена, код', view: RegexTool },
  { id: 'time', icon: 'timer', label: 'Timestamp', hint: 'Unix-время, ISO, RFC, часовые пояса', view: TimestampTool },
  { id: 'cron', icon: 'repeat', label: 'Cron', hint: 'Выражение ↔ расписание словами, ближайшие запуски', view: CronTool },
  { id: 'clip', icon: 'clipboard', label: 'Буфер обмена', hint: 'Всё, что вы копировали', view: ClipTool },
  { id: 'pdf', icon: 'signature', label: 'Подпись PDF', hint: 'Подписать PDF-документ', view: PdfSignView },
] as const satisfies ReadonlyArray<{ id: string; icon: string; label: string; hint: string; view: Component }>
type Tool = (typeof TOOLS)[number]['id']
const KEY = 'qa.tools'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { tool?: Tool; w?: number; mini?: boolean }
  } catch {
    return {}
  }
})()
const tool = ref<Tool>(TOOLS.some((t) => t.id === saved.tool) ? saved.tool! : 'diff')
const current = computed(() => TOOLS.find((t) => t.id === tool.value) ?? TOOLS[0])
const width = ref(Math.min(360, Math.max(170, saved.w ?? 220)))
const mini = ref(!!saved.mini)
watch([tool, width, mini], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tool: tool.value, w: width.value, mini: mini.value }))
  } catch {
    // fine
  }
})
function dragWidth(e: PointerEvent): void {
  e.preventDefault()
  const x0 = e.clientX
  const w0 = width.value
  const move = (ev: PointerEvent) => (width.value = Math.min(360, Math.max(170, w0 + ev.clientX - x0)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="tools tw:grid tw:h-full tw:min-h-0" :style="{ gridTemplateColumns: `${mini ? 52 : width}px minmax(0, 1fr)` }">
    <aside class="tside tw:group/tside tw:relative tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:border-r tw:border-r-border tw:bg-panel" :class="{ mini }">
      <div class="th tw:flex-none tw:flex tw:items-center tw:h-38 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-14 tw:border-b tw:border-b-border tw:group-[.mini]/tside:justify-center tw:group-[.mini]/tside:p-0">
        <span v-if="!mini" class="cap tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap">Инструменты</span>
        <button class="fold tw:flex-none tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" :title="mini ? 'Развернуть панель' : 'Свернуть до значков'" @click="mini = !mini"><Icon :name="mini ? 'chevronRight' : 'chevronLeft'" :size="14" /></button>
      </div>
      <nav class="tl tw:flex tw:flex-col tw:gap-2 tw:p-6">
        <button v-for="t in TOOLS" :key="t.id" class="ti tw:flex tw:items-center tw:gap-10 tw:h-34 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[13px] tw:text-left tw:whitespace-nowrap tw:group-[.mini]/tside:justify-center tw:group-[.mini]/tside:p-0 tw:hover:not-[&.on]:bg-hover tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/16 tw:[&.on]:text-text-hi tw:[&.on]:[box-shadow:inset_2px_0_0_var(--accent)] tw:hover:enabled:border-border-3" :class="{ on: tool === t.id }" :title="mini ? `${t.label} — ${t.hint}` : t.hint" @click="tool = t.id">
          <Icon :name="t.icon" :size="16" />
          <span v-if="!mini" class="tn tw:overflow-hidden tw:text-ellipsis">{{ t.label }}</span>
        </button>
      </nav>
      <span v-if="!mini" class="grip tw:absolute tw:top-0 tw:-right-3 tw:bottom-0 tw:z-3 tw:w-6 tw:cursor-col-resize tw:hover:bg-accent-line" title="Ширина панели" @pointerdown="dragWidth"></span>
    </aside>
    <section class="tbody tw:min-w-0 tw:min-h-0 tw:overflow-hidden">
      <KeepAlive>
        <component :is="current.view" />
      </KeepAlive>
    </section>
  </div>
</template>

<style scoped src="./ToolsView.css"></style>
