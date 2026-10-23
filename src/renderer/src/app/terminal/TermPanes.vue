<script setup lang="ts">
/** One or two panes of shells, each with its tabs: switch, rename, close, drag between panes or to split; the split's width. */
import { ref } from 'vue'
import { shellLight } from '@shared/terminalEdit'
import Icon from '../../components/Icon.vue'
import TermPane from '../../components/TermPane.vue'
import ZoomChip from '../../components/ZoomChip.vue'
import { vFocusSelect as vFocus } from '../../lib/focusSelect'
import { termLayout } from '../../lib/terminal'
import { useTermView } from './termViewContext'
import { useTermTabDrag } from './useTermTabDrag'

const { prefs, alerts, shells } = useTermView()
const { zoom, sideHidden, fontSize } = prefs
const { byId, paneRefs, newShell, toggleSplit, closeShell } = shells
const panesEl = ref<HTMLElement>()
const { tabDrag, zone, dragTitle, onTabDown, onTabClick } = useTermTabDrag(panesEl, shells)

/** The tab being renamed. */
const renaming = ref<string>()
function rename(id: string, title: string): void {
  renaming.value = undefined
  void window.qa.termRename(id, title)
}
const ledOf = (id: string) => shellLight(alerts.value, id, byId(id))

/** The split's width dragged by the bar between the panes. */
function onSplitResize(e: PointerEvent): void {
  const x0 = e.clientX
  const s0 = termLayout.split
  const w = panesEl.value?.clientWidth ?? 1000
  const move = (ev: PointerEvent) => (termLayout.split = Math.min(0.8, Math.max(0.2, s0 + (ev.clientX - x0) / w)))
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
      <div ref="panesEl" class="npanes tw:relative tw:flex-1 tw:min-w-0 tw:min-h-0 tw:flex">
        <template v-for="(p, pi) in termLayout.panes" :key="p.id">
          <div v-if="pi" class="psplit tw:flex-none tw:w-5 tw:my-0 tw:-mx-2 tw:py-0 tw:px-2 tw:bg-border tw:[&&]:bg-clip-content tw:cursor-col-resize tw:z-2 tw:[transition:background-color_0.12s] tw:hover:bg-accent/85" title="Потяните — ширина" @pointerdown.prevent="onSplitResize"></div>
          <section
            class="pane tw:relative tw:min-w-0 tw:flex tw:flex-col tw:[&.cur]:after:content-[''] tw:[&.cur]:after:absolute tw:[&.cur]:after:top-0 tw:[&.cur]:after:left-0 tw:[&.cur]:after:right-0 tw:[&.cur]:after:h-2 tw:[&.cur]:after:bg-accent/80 tw:[&.cur]:after:pointer-events-none"
            :class="{ cur: termLayout.cur === pi && termLayout.panes.length > 1 }"
            :style="{ flex: termLayout.panes.length > 1 ? `${pi ? 1 - termLayout.split : termLayout.split} 1 0` : '1 1 0' }"
            @pointerdown.capture="termLayout.cur = pi"
          >
            <div class="tbar tw:flex-none tw:flex tw:items-center tw:gap-2 tw:h-38 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-4 tw:border-b tw:border-b-border tw:bg-bg">
              <button v-if="sideHidden && pi === 0" class="tb tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Показать панель" @click="sideHidden = false"><Icon name="sidebar" :size="14" /></button>
              <div class="tscroll tw:flex-1 tw:min-w-0 tw:flex tw:items-end tw:self-stretch tw:gap-2 tw:overflow-x-auto tw:scrollbar-none">
                <TransitionGroup tag="div" name="tabmv" class="tlist tw:flex tw:items-end tw:gap-2 tw:min-w-0 tw:relative">
                  <div
                    v-for="id in p.tabs"
                    :key="id"
                    class="tab tw:group/tab tw:flex-[0_1_170px] tw:min-w-90 tw:flex tw:items-center tw:gap-7 tw:h-31 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-10 tw:rounded-[4px_4px_0_0] tw:text-muted tw:font-data tw:text-[11.5px] tw:cursor-pointer tw:select-none tw:hover:not-[&.on]:not-[&.dragging]:bg-white/4 tw:hover:not-[&.on]:text-text tw:[&.on]:not-[&.dragging]:bg-panel tw:[&.on]:text-text-hi tw:[&.on]:[box-shadow:inset_0_2px_0_var(--accent)] tw:[&.dead]:not-[&.dragging]:opacity-[0.55] tw:[&.dragging]:bg-accent/16 tw:[&.dragging]:opacity-100"
                    :class="{ on: p.active === id, dragging: tabDrag?.id === id, dead: byId(id)?.exited !== undefined }"
                    :data-id="id"
                    @pointerdown="onTabDown($event, pi, id)"
                    @click="onTabClick(pi, id)"
                    @dblclick="renaming = id"
                    @mousedown.middle.prevent="closeShell(id)"
                  >
                    <i class="led tw:flex-none tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-dim tw:[&.run]:not-[&.err]:bg-up tw:[&.run]:not-[&.alert]:animate-[TerminalView-tv-blink_1s_steps(2)_infinite] tw:[&.err]:bg-down tw:[&.alert]:animate-[TerminalView-tv-blink_0.36s_steps(2)_infinite]" :class="ledOf(id).cls" :style="ledOf(id).style"></i>
                    <input v-if="renaming === id" v-focus class="ren tw:w-100 tw:h-20 tw:py-0 tw:px-4 tw:text-[11.5px]" :value="byId(id)?.title" @click.stop @keydown.enter="($event.target as HTMLInputElement).blur()" @blur="rename(id, ($event.target as HTMLInputElement).value)" />
                    <span v-else class="tname tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ byId(id)?.title }}</span>
                    <button class="tx tw:flex-none tw:inline-flex tw:p-2 tw:border-0 tw:rounded-r2 tw:[background:none] tw:text-muted tw:opacity-0 tw:group-hover/tab:not-group-[.on]/tab:opacity-100 tw:group-[.on]/tab:opacity-100 tw:hover:bg-white/10 tw:hover:text-down-fg tw:hover:enabled:border-border-3" title="Закрыть оболочку (средняя кнопка мыши)" @click.stop="closeShell(id)"><Icon name="x" :size="11" /></button>
                  </div>
                </TransitionGroup>
                <button class="tnew tw:flex-none tw:self-end tw:mb-4 tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:[background:none] tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" title="Новая оболочка" @click="newShell(pi)"><Icon name="plus" :size="13" /></button>
              </div>
              <button class="tb tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :class="{ on: termLayout.panes.length > 1 }" :title="termLayout.panes.length > 1 ? 'Одна колонка (вкладки соберутся слева)' : 'Разделить: вторая колонка со своими вкладками'" @click="toggleSplit">
                <Icon name="columns" :size="14" />
              </button>
              <ZoomChip v-if="pi === termLayout.panes.length - 1" v-model="zoom" :min="60" :max="220" title="Масштаб терминала · колесо, Ctrl+колесо над терминалом · клик — 100%" />
            </div>
            <div class="pbody tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:p-8">
              <template v-for="id in p.tabs" :key="id">
                <TermPane class="tw:flex-1"
                  v-if="byId(id)"
                  v-show="p.active === id"
                  :ref="(el) => (el ? paneRefs.set(id, el as InstanceType<typeof TermPane>) : paneRefs.delete(id))"
                  :session="byId(id)!"
                  :font-size="fontSize"
                  :active="p.active === id && termLayout.cur === pi"
                  @focus="termLayout.cur = pi"
                  @zoom="(d) => (zoom = Math.min(220, Math.max(60, zoom + d * 10)))"
                />
              </template>
              <div v-if="!p.tabs.length" class="nopane tw:flex-1 tw:flex tw:items-center tw:justify-center tw:gap-8 tw:border tw:border-dashed tw:border-border-2 tw:rounded-r3 tw:text-muted tw:text-[12.5px] tw:cursor-default tw:hover:border-accent tw:hover:text-accent-fg" @click="newShell(pi)"><Icon name="plus" :size="16" />Новая оболочка</div>
            </div>
            <template v-if="tabDrag">
              <template v-if="termLayout.panes.length === 1">
                <template v-if="p.tabs.length > 1">
                  <div class="dz l tw:absolute tw:top-38 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:[transition:background_0.12s,border-color_0.12s] tw:left-0 tw:w-[30%] tw:pointer-events-none tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.side === 'left' }"><span>Разделить влево</span></div>
                  <div class="dz r tw:absolute tw:top-38 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:[transition:background_0.12s,border-color_0.12s] tw:right-0 tw:w-[30%] tw:pointer-events-none tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.side === 'right' }"><span>Разделить вправо</span></div>
                </template>
              </template>
              <div v-else-if="tabDrag.pane !== pi" class="dz all tw:absolute tw:top-38 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:[transition:background_0.12s,border-color_0.12s] tw:left-0 tw:right-0 tw:pointer-events-none tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.pane === pi }"><span>Перенести сюда</span></div>
            </template>
          </section>
        </template>
      </div>
  <Teleport to="body">
    <!-- the dragged tab follows the pointer -->
      <div v-if="tabDrag" class="tghost tw:fixed tw:z-3000 tw:py-4 tw:px-10 tw:border tw:border-accent tw:rounded-r2 tw:bg-panel tw:shadow-pop tw:text-text-hi tw:font-data tw:text-[11.5px] tw:pointer-events-none" :style="{ left: tabDrag.x + 12 + 'px', top: tabDrag.y + 10 + 'px' }">{{ dragTitle }}</div>
  </Teleport>
</template>

<style scoped src="./TermPanes.css"></style>
