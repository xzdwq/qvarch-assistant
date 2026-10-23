<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { bLayout, type BPane } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/** A pane's tabs (dragged to reorder, to the other pane, to split), a new tab, the split's button. */
defineProps<{ p: BPane; pi: number }>()
const view = useBrowserView()
const { byId, closeTab, newTab, toggleSplit } = view.tabs
const { tabDrag, onTabDown, onTabClick } = view.paneDrag
</script>

<template>
  <div class="tbar tw:flex-none tw:flex tw:items-center tw:gap-2 tw:h-36 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-4 tw:bg-bg">
    <div class="tscroll tw:flex-1 tw:min-w-0 tw:flex tw:items-end tw:self-stretch tw:gap-2 tw:overflow-x-auto tw:scrollbar-none">
      <TransitionGroup tag="div" name="tabmv" class="tlist tw:relative tw:flex tw:items-end tw:gap-2 tw:min-w-0">
        <div
          v-for="id in p.tabs"
          :key="id"
          class="tab tw:group/tab tw:flex-[0_1_200px] tw:min-w-90 tw:flex tw:items-center tw:gap-7 tw:h-30 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-10 tw:rounded-[6px_6px_0_0] tw:text-muted tw:text-[12px] tw:cursor-pointer tw:select-none tw:touch-none tw:hover:not-[&.on]:not-[&.dragging]:bg-white/4 tw:hover:not-[&.on]:text-text tw:[&.on]:not-[&.dragging]:bg-panel tw:[&.on]:text-text-hi tw:[&.dragging]:bg-accent/16"
          :class="{ on: p.active === id, dragging: tabDrag?.id === id, asleep: byId(id)?.asleep }"
          :data-id="id"
          :title="byId(id)?.asleep ? `${byId(id)?.url}\nВкладка спит (память освобождена) — откроется при показе` : byId(id)?.url"
          @pointerdown="onTabDown($event, pi, id)"
          @click="onTabClick(pi, id)"
          @mousedown.middle.prevent="closeTab(id)"
        >
          <span v-if="byId(id)?.loading" class="spin tw:flex-none tw:w-12 tw:h-12 tw:border-2 tw:border-border-2 tw:[&&]:border-t-accent tw:rounded-[50%] tw:animate-[BrowserView-bv-spin_0.8s_linear_infinite]"></span>
          <img v-else-if="byId(id)?.favicon" class="fav tw:flex-none tw:w-14 tw:h-14 tw:group-[.asleep]/tab:opacity-[0.55]" :src="byId(id)!.favicon" alt="" />
          <Icon v-else name="globe" :size="12" class="fav0 tw:[&&]:flex-none tw:text-muted tw:group-[.asleep]/tab:opacity-[0.55]" />
          <span class="tname tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:group-[.asleep]/tab:opacity-[0.55]">{{ byId(id)?.title || 'Новая вкладка' }}</span>
          <button class="tx tw:flex-none tw:inline-flex tw:p-2 tw:border-0 tw:rounded-r2 tw:[background:none] tw:text-muted tw:opacity-0 tw:group-hover/tab:not-group-[.on]/tab:opacity-100 tw:group-[.on]/tab:opacity-100 tw:hover:bg-white/10 tw:hover:text-down-fg tw:hover:enabled:border-border-3" title="Закрыть (Ctrl+W, средняя кнопка)" @click.stop="closeTab(id)"><Icon name="x" :size="11" /></button>
        </div>
      </TransitionGroup>
      <button class="tnew tw:flex-none tw:self-end tw:mb-4 tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:[background:none] tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" title="Новая вкладка (Ctrl+T)" @click="newTab(pi)"><Icon name="plus" :size="13" /></button>
    </div>
    <button class="tb tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :class="{ on: bLayout.panes.length > 1 }" :title="bLayout.panes.length > 1 ? 'Одна колонка (вкладки соберутся слева)' : 'Разделить: вторая колонка со своими вкладками'" @click="toggleSplit"><Icon name="columns" :size="14" /></button>
  </div>
</template>

<style scoped src="./PaneTabBar.css"></style>
