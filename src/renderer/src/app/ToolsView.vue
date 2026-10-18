<script setup lang="ts">
import { ref, watch } from 'vue'
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
type Tool = 'pdf' | 'diff' | 'codec' | 'clip' | 'cron' | 'regex' | 'yaml' | 'time'
const TOOLS: Array<{ id: Tool; icon: string; label: string; hint: string }> = [
  { id: 'diff', icon: 'diff', label: 'Сравнение текстов', hint: 'Два текста или JSON: что изменилось' },
  { id: 'codec', icon: 'binary', label: 'Кодировки', hint: 'JWT, UUID, Base64 (и изображения), хэши MD5 / SHA' },
  { id: 'yaml', icon: 'braces', label: 'JSON ↔ YAML', hint: 'Перевод в обе стороны и форматирование' },
  { id: 'regex', icon: 'regex', label: 'Регулярные выражения', hint: 'Проверка, группы, замена, код' },
  { id: 'time', icon: 'timer', label: 'Timestamp', hint: 'Unix-время, ISO, RFC, часовые пояса' },
  { id: 'cron', icon: 'repeat', label: 'Cron', hint: 'Выражение ↔ расписание словами, ближайшие запуски' },
  { id: 'clip', icon: 'clipboard', label: 'Буфер обмена', hint: 'Всё, что вы копировали' },
  { id: 'pdf', icon: 'signature', label: 'Подпись PDF', hint: 'Подписать PDF-документ' },
]
const KEY = 'qa.tools'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { tool?: Tool; w?: number; mini?: boolean }
  } catch {
    return {}
  }
})()
const tool = ref<Tool>(TOOLS.some((t) => t.id === saved.tool) ? saved.tool! : 'diff')
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
  <div class="tools" :style="{ gridTemplateColumns: `${mini ? 52 : width}px minmax(0, 1fr)` }">
    <aside class="tside" :class="{ mini }">
      <div class="th">
        <span v-if="!mini" class="cap">Инструменты</span>
        <button class="fold" :title="mini ? 'Развернуть панель' : 'Свернуть до значков'" @click="mini = !mini"><Icon :name="mini ? 'chevronRight' : 'chevronLeft'" :size="14" /></button>
      </div>
      <nav class="tl">
        <button v-for="t in TOOLS" :key="t.id" class="ti" :class="{ on: tool === t.id }" :title="mini ? `${t.label} — ${t.hint}` : t.hint" @click="tool = t.id">
          <Icon :name="t.icon" :size="16" />
          <span v-if="!mini" class="tn">{{ t.label }}</span>
        </button>
      </nav>
      <span v-if="!mini" class="grip" title="Ширина панели" @pointerdown="dragWidth"></span>
    </aside>
    <section class="tbody">
      <KeepAlive>
        <DiffTool v-if="tool === 'diff'" />
        <CodecTool v-else-if="tool === 'codec'" />
        <ClipTool v-else-if="tool === 'clip'" />
        <CronTool v-else-if="tool === 'cron'" />
        <RegexTool v-else-if="tool === 'regex'" />
        <YamlTool v-else-if="tool === 'yaml'" />
        <TimestampTool v-else-if="tool === 'time'" />
        <PdfSignView v-else />
      </KeepAlive>
    </section>
  </div>
</template>

<style scoped>
.tools {
  display: grid;
  height: 100%;
  min-height: 0;
}
.tside {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
}
.th {
  flex: none;
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 6px 0 14px;
  border-bottom: 1px solid var(--border);
}
.tside.mini .th {
  justify-content: center;
  padding: 0;
}
.th .cap {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.fold {
  flex: none;
  display: inline-flex;
  padding: 5px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.fold:hover {
  background: var(--hover);
  color: var(--text);
}
.tl {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
}
.ti {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
}
.tside.mini .ti {
  justify-content: center;
  padding: 0;
}
.ti:hover {
  background: var(--hover);
  color: var(--text);
}
.ti.on {
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--text-hi);
  box-shadow: inset 2px 0 0 var(--accent);
}
.ti.on :deep(svg) {
  color: var(--accent-fg);
}
.tn {
  overflow: hidden;
  text-overflow: ellipsis;
}
.grip {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  z-index: 3;
  width: 6px;
  cursor: col-resize;
}
.grip:hover {
  background: var(--accent-line);
}
.tbody {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.tbody > :deep(*) {
  height: 100%;
}
</style>
