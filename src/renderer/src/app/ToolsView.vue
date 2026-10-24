<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toolsIds } from '@shared/places'
import type { UiPrefs } from '@shared/types'
import Icon from '../components/Icon.vue'
import { openHttp, openPlace, toolSel, view } from '../lib/views'
import { toolItem } from './toolsRegistry'

/**
 * Инструменты: a side list (its width dragged; folded down to the icons) and the one picked — its own tools
 * (comparing texts, encodings, JSON ↔ YAML, regular expressions, timestamps, cron, the clipboard's history, signing
 * a PDF) and the sections the person moved here (Настройки → Оформление → Меню), in the person's order. The
 * terminal and the browser stay once opened (their sessions, their pages); the window keeps this section on too.
 */
const props = defineProps<{ menu: UiPrefs['menu'] }>()
const items = computed(() => toolsIds(props.menu).flatMap((id) => (toolItem(id) ? [{ id, ...toolItem(id)! }] : [])))
const current = computed(() => items.value.find((t) => t.id === toolSel.value) ?? items.value[0])
/** The ones that stay once opened. */
const opened = ref(new Set<string>())
watch(current, (c) => c?.alive && (opened.value = new Set([...opened.value, c.id])), { immediate: true })
const alive = computed(() => items.value.filter((t) => t.alive && opened.value.has(t.id)))
const shown = computed(() => view.value === 'tools')

const KEY = 'qa.tools'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { w?: number; mini?: boolean }
  } catch {
    return {}
  }
})()
const width = ref(Math.min(360, Math.max(170, saved.w ?? 220)))
const mini = ref(!!saved.mini)
watch([width, mini], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ w: width.value, mini: mini.value }))
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
      <nav class="tl tw:flex tw:flex-col tw:gap-2 tw:p-6 tw:overflow-y-auto">
        <button v-for="t in items" :key="t.id" class="ti tw:flex tw:items-center tw:gap-10 tw:h-34 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[13px] tw:text-left tw:whitespace-nowrap tw:group-[.mini]/tside:justify-center tw:group-[.mini]/tside:p-0 tw:hover:not-[&.on]:bg-hover tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/16 tw:[&.on]:text-text-hi tw:[&.on]:[box-shadow:inset_2px_0_0_var(--accent)] tw:hover:enabled:border-border-3" :class="{ on: current?.id === t.id }" :title="mini ? `${t.label} — ${t.hint}` : t.hint" @click="openPlace(t.id)">
          <Icon :name="t.icon" :size="16" />
          <span v-if="!mini" class="tn tw:overflow-hidden tw:text-ellipsis">{{ t.label }}</span>
        </button>
      </nav>
      <span v-if="!mini" class="grip tw:absolute tw:top-0 tw:-right-3 tw:bottom-0 tw:z-3 tw:w-6 tw:cursor-col-resize tw:hover:bg-accent-line" title="Ширина панели" @pointerdown="dragWidth"></span>
    </aside>
    <section class="tbody tw:relative tw:min-w-0 tw:min-h-0 tw:overflow-hidden">
      <!-- the terminal and the browser: kept once opened; the rest — the picked one -->
      <component :is="t.view" v-for="t in alive" v-show="current?.id === t.id" :key="t.id" class="tw:[&&]:h-full" :active="shown && current?.id === t.id" @open-http="openHttp" />
      <KeepAlive v-if="current && !current.alive">
        <component :is="current.view" :key="current.id" />
      </KeepAlive>
    </section>
  </div>
</template>

<style scoped src="./ToolsView.css"></style>
