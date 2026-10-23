<script setup lang="ts">
import { bLayout, type BPane } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'
import PaneNavBar from './PaneNavBar.vue'
import PanePage from './PanePage.vue'
import PaneTabBar from './PaneTabBar.vue'

/** One pane of the section: its tabs, its navigation and address line, its page; the drop zones while a tab is dragged. */
defineProps<{ p: BPane; pi: number }>()
const { tabDrag, zone } = useBrowserView().paneDrag
</script>

<template>
  <section class="pane tw:relative tw:min-w-0 tw:flex tw:flex-col tw:[&.cur]:after:content-[''] tw:[&.cur]:after:absolute tw:[&.cur]:after:top-0 tw:[&.cur]:after:left-0 tw:[&.cur]:after:right-0 tw:[&.cur]:after:h-2 tw:[&.cur]:after:bg-accent/80 tw:[&.cur]:after:pointer-events-none" :class="{ cur: bLayout.cur === pi && bLayout.panes.length > 1 }" :style="{ flex: bLayout.panes.length > 1 ? `${pi ? 1 - bLayout.split : bLayout.split} 1 0` : '1 1 0' }" @pointerdown.capture="bLayout.cur = pi">
    <PaneTabBar :p="p" :pi="pi" />
    <PaneNavBar :p="p" :pi="pi" />
    <PanePage :p="p" />
    <template v-if="tabDrag">
      <template v-if="bLayout.panes.length === 1 && p.tabs.length > 1">
        <div class="dz l tw:absolute tw:top-74 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:pointer-events-none tw:left-0 tw:w-[30%] tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.side === 'left' }"><span class="">Разделить влево</span></div>
        <div class="dz r tw:absolute tw:top-74 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:pointer-events-none tw:right-0 tw:w-[30%] tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.side === 'right' }"><span class="">Разделить вправо</span></div>
      </template>
      <div v-else-if="bLayout.panes.length > 1 && tabDrag.pane !== pi" class="dz all tw:absolute tw:top-74 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:pointer-events-none tw:left-0 tw:right-0 tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.pane === pi }"><span class="">Перенести сюда</span></div>
    </template>
  </section>
</template>
