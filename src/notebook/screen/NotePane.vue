<script setup lang="ts">
import Icon from '@renderer/components/Icon.vue'
import { layout, type Pane } from '@nb/workspace/paneLayout'
import { useNotebookScreen } from './notebookScreen'
import PaneTabs from './PaneTabs.vue'
import NoteBody from './NoteBody.vue'
import NotebookGraph from './graph/NotebookGraph.vue'
import { GRAPH_TAB } from '@nb/workspace/viewTabs'

/**
 * One pane of the notes: its tab row, its open file (or what to do when there is none), and — while a tab is
 * dragged — the drop zones: at the edges a split, over the other pane a move there.
 */
defineProps<{ p: Pane; pi: number }>()
const { actions, search, tabs } = useNotebookScreen()
const { newNote, newBoard } = actions
const { toggleSearch } = search
const { tabDrag, zone, onZoneDrop } = tabs
const tabOf = (p: Pane) => p.tabs.find((t) => t.path === p.active)
</script>

<template>
  <section class="pane tw:min-w-0 tw:flex tw:flex-col tw:relative tw:[&.cur]:after:content-[''] tw:[&.cur]:after:absolute tw:[&.cur]:after:top-0 tw:[&.cur]:after:left-0 tw:[&.cur]:after:right-0 tw:[&.cur]:after:h-2 tw:[&.cur]:after:bg-accent/80" :class="{ cur: layout.cur === pi && layout.panes.length > 1 }" :style="{ flex: layout.panes.length > 1 ? `${pi ? 1 - layout.split : layout.split} 1 0` : '1 1 0' }" @pointerdown.capture="layout.cur = pi">
    <PaneTabs :p="p" :pi="pi" />

    <NotebookGraph v-if="tabOf(p) && p.active === GRAPH_TAB" :key="p.id" :pi="pi" />
    <NoteBody v-else-if="tabOf(p) && p.active" :p="p" :pi="pi" :path="p.active" />
    <div v-else class="pempty tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:text-muted">
      <Icon name="notebook" :size="34" />
      <p class="tw:m-0">Нет открытой заметки</p>
      <div class="erow tw:flex tw:gap-8">
        <button class="primary tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:inline-flex tw:items-center tw:gap-6 tw:hover:enabled:border-accent-hi" @click="newNote(undefined, pi)"><Icon name="filePlus" :size="14" />Новая заметка</button>
        <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:inline-flex tw:items-center tw:gap-6" @click="newBoard(undefined, pi)"><Icon name="presentation" :size="14" />Новая доска</button>
        <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:inline-flex tw:items-center tw:gap-6" @click="toggleSearch(true)"><Icon name="search" :size="14" />Найти</button>
      </div>
      <p class="muted small tw:m-0 tw:text-[12px]">Ctrl+N — новая · Ctrl+Shift+F — поиск · Ctrl+\ — две колонки · Ctrl + колесо — масштаб</p>
    </div>
    <template v-if="tabDrag">
      <template v-if="layout.panes.length === 1">
        <div class="dz l tw:absolute tw:top-36 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:[transition:background_0.12s,border-color_0.12s] tw:left-0 tw:w-[30%] tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.side === 'left' }" @dragover.prevent="zone = { pane: pi, side: 'left' }" @dragleave="zone = undefined" @drop.prevent="onZoneDrop"><span class="tw:pointer-events-none">Разделить влево</span></div>
        <div class="dz r tw:absolute tw:top-36 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:[transition:background_0.12s,border-color_0.12s] tw:right-0 tw:w-[30%] tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.side === 'right' }" @dragover.prevent="zone = { pane: pi, side: 'right' }" @dragleave="zone = undefined" @drop.prevent="onZoneDrop"><span class="tw:pointer-events-none">Разделить вправо</span></div>
      </template>
      <div v-else-if="tabDrag.pane !== pi" class="dz all tw:absolute tw:top-36 tw:bottom-0 tw:z-20 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-transparent tw:rounded-[4px] tw:text-transparent tw:text-[13px] tw:[transition:background_0.12s,border-color_0.12s] tw:left-0 tw:right-0 tw:[&.hot]:border-accent tw:[&.hot]:bg-accent/14 tw:[&.hot]:text-accent-fg" :class="{ hot: zone?.pane === pi }" @dragover.prevent="zone = { pane: pi, side: 'here' }" @dragleave="zone = undefined" @drop.prevent="onZoneDrop"><span class="tw:pointer-events-none">Перенести сюда</span></div>
    </template>
  </section>
</template>
