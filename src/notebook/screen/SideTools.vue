<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { placeFloat } from '@renderer/lib/floating'
import type { Placement } from '@renderer/lib/usePopover'
import { SORTS } from '@shared/vaultTree'
import { layout } from '@nb/workspace/paneLayout'
import { useNotebookScreen } from './notebookScreen'

/** The notes side's tool bar: hide the side, new note / board / folder / voice note, search, the order, fold all. */
const { actions, voice, search } = useNotebookScreen()
const { newNote, newBoard, newFolder } = actions
const { newVoiceNote } = voice
const { toggleSearch } = search

// sort menu: a popover of its button, but as wide as the tool bar and under it
const sortOpen = ref(false)
const toolsEl = ref<HTMLElement>()
const sortBtn = ref<HTMLElement>()
const underBar: Placement = ({ el }) => {
  const bar = toolsEl.value ?? el!
  const r = bar.getBoundingClientRect()
  const f = placeFloat(bar, Math.max(160, r.width - 16), true, 0)
  return { style: { ...f.style, left: `${Math.max(8, Math.min(r.left + 8, window.innerWidth - parseFloat(f.style.width) - 8))}px`, maxHeight: `${f.maxH}px` }, up: f.up, room: f.maxH }
}
</script>

<template>
  <div ref="toolsEl" class="ntools tw:flex-none tw:flex tw:items-center tw:gap-2 tw:pt-8 tw:pr-8 tw:pb-6 tw:pl-8">
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text" title="Скрыть панель" @click="layout.sideHidden = true"><Icon name="sidebar" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text" title="Новая заметка (Ctrl+N)" @click="newNote()"><Icon name="filePlus" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text" title="Новая доска — полотно для схем и записей" @click="newBoard()"><Icon name="presentation" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text" title="Новый раздел (папка)" @click="newFolder()"><Icon name="folderPlus" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text" title="Голосовая заметка" @click="newVoiceNote"><Icon name="mic" :size="15" /></button>
    <span class="grow tw:flex-1"></span>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:bg-white/7 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11px] tw:[&&]:[.zoom_&]:hover:bg-white/8 tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: layout.sideTab === 'search' }" title="Поиск по всем заметкам" @click="toggleSearch()"><Icon name="search" :size="15" /></button>
    <span class="sortwrap tw:inline-flex">
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:bg-white/7 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11px] tw:[&&]:[.zoom_&]:hover:bg-white/8 tw:[&&]:[.zoom_&]:hover:text-text" ref="sortBtn" :class="{ on: sortOpen }" title="Сортировка" @click="sortOpen = !sortOpen"><Icon name="sort" :size="15" /></button>
      <Popover v-model:open="sortOpen" :anchor="sortBtn" :place="underBar" class="sortmenu tw:box-border tw:overflow-y-auto tw:p-5 tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)] tw:flex tw:flex-col">
          <button class="tw:[.zoom_&]:min-w-20 tw:inline-flex tw:flex-none tw:items-center tw:justify-start tw:gap-8 tw:w-auto tw:h-auto tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:whitespace-nowrap tw:hover:not-[&.on]:bg-white/7 tw:hover:text-text tw:[&.on]:bg-accent/16" v-for="s in SORTS" :key="s.id" :class="{ on: layout.sort === s.id }" @click="(layout.sort = s.id), (sortOpen = false)">
            <Icon v-if="layout.sort === s.id" name="check" :size="12" /><span v-else class="sp tw:inline-block tw:w-12"></span>{{ s.label }}
          </button>
      </Popover>
    </span>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text" title="Свернуть все разделы" @click="layout.open = []"><Icon name="collapse" :size="15" /></button>
  </div>
</template>
