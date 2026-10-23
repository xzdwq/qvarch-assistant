<script setup lang="ts">
import { isBoard } from '@shared/whiteboard'
import Icon from '@renderer/components/Icon.vue'
import NodeMark from '@renderer/components/NodeMark.vue'
import { noteReport, noteRun, runAll, stopRunAll } from '@nb/engine'
import { docs, isDirty } from '@nb/workspace/noteDocs'
import { closeTab, layout, toggleSplit, type Pane } from '@nb/workspace/paneLayout'
import { noteName } from '@nb/domain/notePaths'
import { useNotebookScreen } from './notebookScreen'
import { isRunnableText } from '@nb/domain/noteFacts'
import { colorOf, emojiOf, pairOf } from './nodeInfo'

/**
 * A pane's tab row: its tabs (dragged to reorder or to the other pane), «+»; for the active note — voice,
 * a picture, its report, its variables, «Выполнить всё»; for the last pane — the text's width, the help, the split.
 */
defineProps<{ p: Pane; pi: number }>()
const { tabs, actions, voice, images, vars, toast, helpOpen } = useNotebookScreen()
const { tabDrag, onTabDragStart, onTabDragOver, onTabRowEnd, onTabDrop } = tabs
const { newNote } = actions
const { recInto, startRec } = voice
const { pickImages } = images
const { varsOpen, toggleVars } = vars

const tabOf = (p: Pane) => p.tabs.find((t) => t.path === p.active)
/** A note «Выполнить всё» runs (blocks that run in it). */
const runnable = (path?: string) => !!path && !isBoard(path) && isRunnableText(docs.get(path)?.text ?? '')
async function copyNoteReport(path: string): Promise<void> {
  await navigator.clipboard.writeText(noteReport(path, docs.get(path)?.text ?? ''))
  toast.say('Отчёт скопирован — вставьте в чат, Jira или письмо')
}
</script>

<template>
  <div class="tabs tw:flex-none tw:flex tw:items-center tw:gap-2 tw:h-38 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-4 tw:bg-bg tw:border-b tw:border-b-border">
    <button v-if="layout.sideHidden && pi === 0" class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Показать панель" @click="layout.sideHidden = false"><Icon name="sidebar" :size="14" /></button>
    <div class="tscroll tw:flex-1 tw:min-w-0 tw:flex tw:items-end tw:self-stretch tw:gap-2 tw:overflow-x-auto tw:scrollbar-none">
      <TransitionGroup tag="div" name="tabmv" class="tlist tw:flex tw:items-end tw:gap-2 tw:min-w-0">
      <div
        v-for="(t, ti) in p.tabs"
        :key="t.path"
        class="tab tw:group/tab tw:flex-[0_1_190px] tw:min-w-90 tw:flex tw:items-center tw:gap-6 tw:h-31 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-10 tw:rounded-[4px_4px_0_0] tw:text-muted tw:text-[12.5px] tw:cursor-pointer tw:select-none tw:hover:not-[&.on]:bg-white/4 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-bg tw:[&.on]:text-text-hi tw:[&.on]:[box-shadow:inset_0_1px_0_var(--pane-tab-on-edge)] tw:[&.dragging]:opacity-45"
        :class="{ on: p.active === t.path, dragging: tabDrag?.path === t.path && tabDrag?.pane === pi }"
        :title="t.path"
        draggable="true"
        @click="p.active = t.path"
        @mousedown.middle.prevent="closeTab(pi, t.path)"
        @dragstart="onTabDragStart(pi, t.path, $event)"
        @dragover="onTabDragOver(pi, ti, $event)"
        @drop.prevent="onTabDrop"
        @dragend="onTabDrop"
      >
        <NodeMark v-if="emojiOf(t.path)" :emoji="emojiOf(t.path)" :color="colorOf(t.path)" icon="note" :size="12" />
        <span v-else-if="colorOf(t.path)" class="fmark sm tw:flex-none tw:rounded-r2 tw:m-0 tw:w-9 tw:h-9" :style="{ background: colorOf(t.path) }"></span>
        <Icon v-else :name="isBoard(t.path) ? 'presentation' : 'note'" :size="12" class="tic tw:[&&]:flex-none tw:opacity-70" />
        <span class="tname tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ noteName(t.path) }}</span>
        <span v-if="isDirty(t.path)" class="ndot tw:flex-none tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-warn"></span>
        <span v-if="pairOf(t.path)" class="tpair tw:inline-flex tw:text-accent-fg" :title="'Связано с: ' + noteName(pairOf(t.path)!)"><Icon name="link" :size="10" /></span>
        <button class="tx tw:flex-none tw:inline-flex tw:p-2 tw:border-0 tw:rounded-r2 tw:[background:none] tw:text-muted tw:opacity-0 tw:group-hover/tab:not-group-[.on]/tab:opacity-100 tw:group-[.on]/tab:opacity-100 tw:hover:bg-white/10 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Закрыть (Ctrl+W)" @click.stop="closeTab(pi, t.path)"><Icon name="x" :size="11" /></button>
      </div>
      </TransitionGroup>
      <button
        class="tnew tw:flex-none tw:self-end tw:mb-4 tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:[background:none] tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3"
        title="Новая заметка (Ctrl+N)"
        @click="newNote(undefined, pi)"
        @dragover="onTabRowEnd(pi, $event)"
        @drop.prevent="onTabDrop"
      ><Icon name="plus" :size="13" /></button>
    </div>
    <template v-if="tabOf(p) && !isBoard(p.active ?? '')">
      <button
        class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&&]:hover:enabled:bg-white/7 tw:[&&]:hover:enabled:text-text tw:[&.rec]:bg-down/20 tw:[&.rec]:text-down-fg tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-[&.rec]:bg-transparent tw:[.zoom_&]:not-[&.rec]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3"
        :class="{ rec: recInto?.pane === p.id }"
        :title="recInto?.pane === p.id ? 'Остановить запись' : 'Записать голос в эту заметку'"
        :disabled="!!recInto && recInto.pane !== p.id"
        @click="startRec(p)"
      >
        <Icon :name="recInto?.pane === p.id ? 'stop' : 'mic'" :size="14" />
      </button>
      <button class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Вставить изображение — или вставьте из буфера (Ctrl+V), или перетащите файл в заметку" @click="pickImages(p)"><Icon name="image" :size="14" /></button>
      <template v-if="runnable(p.active)">
        <button class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Скопировать отчёт по заметке: итог, каждый блок, ошибки целиком — готовым текстом" @click="copyNoteReport(p.active!)"><Icon name="clipboard" :size="14" /></button>
        <button class="tb nrun-b tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&&]:hover:enabled:bg-white/7 tw:[&&]:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-[&.on]:bg-transparent tw:[.zoom_&]:not-[&.on]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :class="{ on: varsOpen?.path === p.active }" title="Переменные заметки — что опубликовали её блоки" @click="toggleVars(p.active!, $event)"><Icon name="braces" :size="14" /></button>
        <button v-if="noteRun(p.active!).all && !noteRun(p.active!).all!.error" class="tb nrun stop tw:justify-center tw:h-28 tw:border-0 tw:disabled:opacity-35 tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:border-0 tw:inline-flex tw:items-center tw:gap-5 tw:w-auto tw:py-0 tw:px-9 tw:rounded-r2 tw:text-[12px] tw:bg-stop tw:text-white tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Остановить выполнение" @click="stopRunAll(p.active!)"><Icon name="stop" :size="11" />{{ noteRun(p.active!).all!.done + 1 }}/{{ noteRun(p.active!).all!.total }}</button>
        <button v-else class="tb nrun tw:justify-center tw:h-28 tw:border-0 tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:border-0 tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:inline-flex tw:items-center tw:gap-5 tw:w-auto tw:py-0 tw:px-9 tw:rounded-r2 tw:bg-accent tw:text-on-accent tw:text-[12px] tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Выполнить всё: блоки HTTP и кода сверху вниз (данные — сразу); первая ошибка останавливает" @click="runAll(p.active!, docs.get(p.active!)!.text)"><Icon name="play" :size="11" />Выполнить всё</button>
      </template>
    </template>
    <button v-if="pi === layout.panes.length - 1" class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&&]:hover:enabled:bg-white/7 tw:[&&]:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-[&.on]:bg-transparent tw:[.zoom_&]:not-[&.on]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :class="{ on: layout.wide }" :title="layout.wide ? 'Обычная ширина текста (820 px)' : 'Текст на всю ширину (с отступами по краям)'" @click="layout.wide = !layout.wide"><Icon name="expand" :size="14" /></button>
    <button v-if="pi === layout.panes.length - 1" class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&&]:hover:enabled:bg-white/7 tw:[&&]:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-[&.on]:bg-transparent tw:[.zoom_&]:not-[&.on]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :class="{ on: helpOpen }" title="Инструкция: блокнот и тестирование" @click="helpOpen = true"><Icon name="book" :size="14" /></button>
    <button class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&&]:hover:enabled:bg-white/7 tw:[&&]:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-[&.on]:bg-transparent tw:[.zoom_&]:not-[&.on]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:not-enabled:bg-white/8 tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :class="{ on: layout.panes.length > 1 }" :title="layout.panes.length > 1 ? 'Одна колонка (Ctrl+\\)' : 'Разделить'" @click="toggleSplit">
      <Icon name="columns" :size="14" />
    </button>
  </div>
</template>

<style scoped src="./PaneTabs.css"></style>
