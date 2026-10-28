<script setup lang="ts">
/** «Создать»: one button for what can be made in the tree — a note (Ctrl+N), a board, a section (folder). */
import { ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { useNotebookScreen } from './notebookScreen'

const { newNote, newBoard, newFolder } = useNotebookScreen().actions
const btn = ref<HTMLElement>()
const open = ref(false)
/** What can be made: its words, its icon, how. */
const ITEMS = [
  { title: 'Заметка', hint: 'Ctrl+N', icon: 'filePlus', make: () => newNote() },
  { title: 'Доска', hint: 'полотно для схем', icon: 'presentation', make: () => newBoard() },
  { title: 'Раздел', hint: 'папка', icon: 'folderPlus', make: () => newFolder() },
] as const
function make(item: (typeof ITEMS)[number]): void {
  open.value = false
  void item.make()
}
</script>

<template>
  <span ref="btn" class="tw:inline-flex">
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:bg-white/7 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" :class="{ on: open }" title="Создать: заметку, доску, раздел" @click="open = !open"><Icon name="plus" :size="16" /></button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="220" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-1 tw:p-5 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
    <button v-for="i in ITEMS" :key="i.title" class="tw:flex tw:items-center tw:gap-8 tw:h-28 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:text-text tw:whitespace-nowrap tw:hover:bg-hover" @click="make(i)">
      <Icon :name="i.icon" :size="14" /><span>{{ i.title }}</span><span class="tw:flex-1"></span><span class="tw:text-muted tw:text-[11px]">{{ i.hint }}</span>
    </button>
  </Popover>
</template>
