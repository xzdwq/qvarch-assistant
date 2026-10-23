<script setup lang="ts">
import { isBoard } from '@shared/whiteboard'
import Icon from '@renderer/components/Icon.vue'
import ZoomChip from '@renderer/components/ZoomChip.vue'
import BoardView from '@renderer/components/BoardView.vue'
import { fmtSec } from '@renderer/lib/recorder'
import { docs, isDirty, setText } from '@nb/workspace/noteDocs'
import { layout, type Pane } from '@nb/workspace/paneLayout'
import { noteName } from '@nb/domain/notePaths'
import { useNotebookScreen } from './notebookScreen'
import { textStats } from '@nb/domain/noteFacts'
import { pairOf, setZoom } from './nodeInfo'
import NoteText from './NoteText.vue'

/**
 * A pane's open file: a note's text or a board; a linked pair — the switch at the right; the recording bar (a board's
 * recording); the status line (saved, its words or the board's word, the text's scale).
 */
defineProps<{
  p: Pane
  pi: number
  /** The pane's active file. */
  path: string
}>()
const { actions, voice, toast, boardInfo } = useNotebookScreen()
const { showPair } = actions
const { recorder, recInto, stopRec } = voice
const { say } = toast
</script>

<template>
  <div class="pbody tw:group/pbody tw:relative tw:flex-1 tw:min-h-0 tw:flex tw:flex-col" :class="{ paired: !!pairOf(path) }" :style="layout.wide ? { '--note-max': 'none', '--note-pad': '32px' } : undefined">
    <div v-if="pairOf(path)" class="pairsw tw:group-[.paired]/pbody:[&:not(.pairsw)]:mr-26 tw:absolute tw:top-0 tw:right-0 tw:bottom-0 tw:z-6 tw:w-26 tw:flex tw:flex-col tw:items-stretch tw:justify-center tw:gap-4 tw:border-l tw:border-l-border tw:bg-white/1.5">
      <button class="pswap tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:flex tw:flex-col tw:items-center tw:gap-4 tw:my-0 tw:mx-2 tw:py-7 tw:px-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-accent-fg tw:text-[10.5px] tw:cursor-pointer tw:hover:bg-accent/18 tw:hover:text-text-hi" :title="`Показать ${isBoard(path) ? 'заметку' : 'доску'} «${noteName(pairOf(path)!)}» здесь`" @click="showPair(pi)">
        <Icon :name="isBoard(path) ? 'note' : 'presentation'" :size="13" /><span class="tw:[writing-mode:vertical-rl]">{{ isBoard(path) ? 'Текст' : 'Доска' }}</span>
      </button>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:flex tw:flex-col tw:items-center tw:gap-4 tw:my-0 tw:mx-2 tw:py-7 tw:px-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-accent-fg tw:text-[10.5px] tw:cursor-pointer tw:hover:bg-accent/18 tw:hover:text-text-hi" title="Открыть рядом (в другой колонке)" @click="showPair(pi, true)"><Icon name="columns" :size="12" /></button>
    </div>
    <div v-if="recInto?.pane === p.id && !recInto.inline" class="recbar tw:group-[.paired]/pbody:[&:not(.pairsw)]:mr-26 tw:flex-none tw:flex tw:items-center tw:gap-10 tw:mt-8 tw:mr-auto tw:mb-0 tw:ml-auto tw:py-6 tw:px-10 tw:rounded-[4px] tw:border tw:border-down/40 tw:bg-down/8 tw:text-[12.5px]">
      <span class="rdot tw:w-9 tw:h-9 tw:rounded-[50%] tw:bg-down tw:animate-[NotebookView-blink_1s_infinite]"></span>
      <span class="meter tw:w-90 tw:h-5 tw:rounded-r2 tw:bg-white/10 tw:overflow-hidden"><span class="tw:block tw:h-full tw:bg-down-fg" :style="{ width: `${recorder.level.value * 100}%` }"></span></span>
      <b class="tw:tabular-nums tw:font-data">{{ fmtSec(recorder.sec.value) }}</b>
      <span class="muted">запись в заметку…</span>
      <button class="stop tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:inline-flex tw:items-center tw:gap-5 tw:py-3 tw:px-9 tw:rounded-r2 tw:text-[12px]" @click="stopRec"><Icon name="stop" :size="11" />Остановить</button>
    </div>
    <div v-if="isBoard(path)" class="pboard tw:group-[.paired]/pbody:[&:not(.pairsw)]:mr-26 tw:flex-1 tw:min-h-0 tw:flex tw:flex-col">
      <BoardView class="tw:flex-1 tw:[&&]:min-h-0"
        v-if="docs.get(path)?.loaded"
        :key="`${p.id}:${path}`"
        :path="path"
        :text="docs.get(path)!.text"
        @change="(t) => setText(path, t)"
        @info="(t) => (boardInfo = { ...boardInfo, [path]: t })"
        @warn="say"
      />
    </div>
    <NoteText v-else :p="p" :path="path" />
    <div class="pstatus tw:group-[.paired]/pbody:[&:not(.pairsw)]:mr-26 tw:flex-none tw:flex tw:items-center tw:gap-8 tw:py-4 tw:px-12 tw:border-t tw:border-t-border tw:text-muted tw:text-[11.5px]">
      <span v-if="docs.get(path)?.error" class="err tw:text-down-fg">{{ docs.get(path)!.error }}</span>
      <span v-else>{{ isDirty(path) ? 'Сохраняется…' : 'Сохранено' }}</span>
      <span class="grow tw:flex-1"></span>
      <span>{{ isBoard(path) ? (boardInfo[path] ?? '') : textStats(docs.get(path)?.text ?? '') }}</span>
      <ZoomChip class="tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:not-hover:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text" v-if="!isBoard(path)" :model-value="layout.zoom || 100" title="Масштаб текста · колесо — изменить, клик — 100%" @update:model-value="setZoom" />
    </div>
  </div>
</template>
