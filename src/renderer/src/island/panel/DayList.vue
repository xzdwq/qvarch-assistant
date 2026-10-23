<script setup lang="ts">
import { formatDuration, formatHM } from '@shared/timeline'
import Icon from '../../components/Icon.vue'
import { kindColor, kindIcon } from '../../lib/palette'
import { AUDIO_NOTE_LOOK } from '@shared/tracker/constants'
import { useIsland } from '../islandState'

/** The day list under the panel: blocks in time order with their notes (it folds); right-click — the kind menu. */
const { day, pick, list, menu } = useIsland()
const { noteIcon } = day
const { entryId, clickEntry, panelNote, openPanelNote } = pick
const { listOpen, toggleList, blockCount, labelledMs, listRows, notesOf } = list
const { openEntryMenu } = menu
</script>

<template>
  <div class="list tw:flex tw:flex-col tw:gap-6">
    <nav class="ltabs tw:flex tw:items-center tw:gap-4">
      <button class="fold tw:py-3! tw:px-4! tw:text-[12px] tw:rounded-r2 tw:bg-transparent tw:border tw:border-transparent tw:text-muted" :title="listOpen ? 'Свернуть' : 'Развернуть'" @click="toggleList">
        <Icon :name="listOpen ? 'chevronDown' : 'chevronRight'" :size="13" />
      </button>
      <button class="on tw:py-3 tw:px-10 tw:text-[12px] tw:rounded-r2 tw:border tw:border-transparent tw:bg-white/6 tw:[&&]:border-white/10 tw:text-text" @click="listOpen = true">
        Записи <span class="cnt tw:ml-3 tw:text-[10px] tw:opacity-70 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ blockCount }}</span>
      </button>
      <span class="spacer tw:flex-1 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"></span>
      <span class="muted small tw:text-[11px] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">размечено {{ formatDuration(labelledMs) }}</span>
    </nav>
    <div v-if="listOpen" class="lbody tw:max-h-168 tw:overflow-y-auto tw:-mr-6 tw:pr-4">
      <template v-for="r in listRows" :key="r.type === 'entry' ? r.e.id : `n${r.n.id}`">
          <div
            v-if="r.type === 'entry'"
            class="lrow tw:cursor-pointer tw:hover:not-[&.sel]:bg-white/5 tw:[&.sel]:bg-accent/18"
            :class="{ sel: r.e.id === entryId }"
            @click="clickEntry(r.e)"
            @contextmenu.prevent="openEntryMenu($event, r.e)"
          >
            <span class="kic sm tw:inline-flex tw:items-center tw:justify-center tw:text-text-hi tw:w-18 tw:h-18 tw:rounded-r2 tw:flex-none tw:[.abar_&]:block" :style="{ background: kindColor(r.e.kind) }"><Icon :name="kindIcon(r.e.kind)" :size="11" :stroke="2.2" /></span>
            <span class="ltime tw:flex-none tw:tabular-nums tw:font-data tw:text-text-2 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
            <span class="llabel tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ r.e.label }}</span>
            <span v-if="notesOf(r.e.id).length" class="nbadge tw:flex-none tw:inline-flex tw:items-center tw:gap-2 tw:py-0 tw:px-5 tw:rounded-r2 tw:bg-warn/18 tw:text-warn tw:text-[10px] tw:font-bold tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="`Заметок к блоку: ${notesOf(r.e.id).length}`"><Icon name="note" :size="10" :stroke="2.4" />{{ notesOf(r.e.id).length }}</span>
            <span class="ldur tw:flex-none tw:tabular-nums tw:font-data tw:ml-auto tw:text-muted tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2 tw:[.arow_&]:text-right">{{ formatDuration(r.e.end - r.e.start) }}</span>
          </div>
          <div
            v-else
            class="lrow nrow tw:[&.owned]:ml-22 tw:[&.owned]:border-l-2 tw:[&.owned]:border-l-warn/40 tw:cursor-pointer tw:hover:not-[&.sel]:bg-white/5 tw:[&.sel]:bg-accent/18"
            :class="{ owned: r.owned, sel: panelNote?.id === r.n.id }"
            :title="r.owned ? 'Заметка к блоку выше' : 'Заметка вне блоков'"
            @click="openPanelNote(r.n)"
          >
            <span class="nic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-18 tw:h-18 tw:rounded-r2 tw:bg-warn tw:text-bg"><Icon :name="noteIcon(r.n)" :size="11" :stroke="2.4" /></span>
            <span class="ltime tw:flex-none tw:tabular-nums tw:font-data tw:text-text-2 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ formatHM(r.n.at) }}</span>
            <span class="llabel ntxt tw:text-warn-fg tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:min-w-0 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ r.n.text || r.n.transcript || (r.n.audio ? AUDIO_NOTE_LOOK[r.n.audio.kind].label : '') }}</span>
          </div>
        </template>
      <p v-if="!blockCount" class="muted empty tw:m-6 tw:text-[12px]">Пока ничего не размечено.</p>
    </div>
  </div>
</template>

<style scoped src="./DayList.css"></style>
