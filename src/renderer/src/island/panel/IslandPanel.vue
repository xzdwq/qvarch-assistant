<script setup lang="ts">
import { type Ref, shallowRef, watch } from 'vue'
import NoteEditor from '../../components/NoteEditor.vue'
import IslandChatView from '../chat/IslandChatView.vue'
import { useIsland } from '../islandState'
import CutForm from './CutForm.vue'
import DayList from './DayList.vue'
import DayTrack from './DayTrack.vue'
import EntryDetails from './EntryDetails.vue'
import IslandMenu from './IslandMenu.vue'
import PanelAxis from './PanelAxis.vue'
import PanelHead from './PanelHead.vue'
import PanelLegend from './PanelLegend.vue'

/**
 * The expanded island: header, then its view (kept) — the day (its timeline: axis, track, legend; below it the open
 * note, the highlighted block or the cut row, then the day list; the right-click menu) or the chats (a room's whole
 * chat). Focus inside keeps it expanded.
 */
const { els, day, pick, expand, chat } = useIsland()
const { panelView } = chat
/** The chats' view's height (the window holds the head and it). */
const CHAT_VIEW_H = 470
const { today, data } = day
const { panelNote, selectedEntry: liveEntry } = pick
const { expanded, onFocusIn, onFocusOut } = expand

/**
 * What the panel shows below the timeline, held while it fades out on collapse: the collapse clears the pick, and
 * the leaving panel (still a live component) would otherwise swap its card for the cut row as it fades.
 */
function heldWhileShown<T>(source: Ref<T>): Ref<T> {
  const held = shallowRef(source.value) as Ref<T>
  watch(source, (v) => {
    if (expanded.value) held.value = v
  })
  return held
}
const shownNote = heldWhileShown(panelNote)
const selectedEntry = heldWhileShown(liveEntry)
</script>

<template>
  <div :ref="els.panel" class="panel tw:absolute tw:top-0 tw:left-0 tw:w-750 tw:pt-0 tw:pr-16 tw:pb-14 tw:pl-16 tw:flex tw:flex-col" @focusin="onFocusIn" @focusout="onFocusOut">
    <PanelHead />

    <!-- the chats instead of the day (the view is kept) -->
    <IslandChatView v-if="panelView === 'chat'" :style="{ height: `${CHAT_VIEW_H}px` }" />

    <template v-else>
      <PanelAxis />

      <DayTrack />

      <PanelLegend />

      <div class="divider tw:h-1 tw:mt-8 tw:-mr-16 tw:mb-12 tw:-ml-16 tw:bg-white/7"></div>

      <Transition name="fade" mode="out-in">
        <!-- a note: new, or opened from its pin -->
        <div v-if="shownNote" :key="`note${shownNote.id}`" class="details tw:flex tw:flex-col tw:gap-10">
          <NoteEditor :day="today" :note="shownNote" :entries="data.entries" :full="data.notes.find((x) => x.id === shownNote!.id)" compact @close="panelNote = undefined" />
        </div>

        <!-- selected entry -->
        <EntryDetails v-else-if="selectedEntry" key="entry" :entry="selectedEntry" />

        <!-- marker / uncut tail -->
        <CutForm v-else key="cut" />
      </Transition>

      <!-- day list: entries + app tracking -->
      <div class="divider tw:h-1 tw:mt-8 tw:-mr-16 tw:mb-12 tw:-ml-16 tw:bg-white/7"></div>
      <DayList />

      <IslandMenu />
    </template>
  </div>
</template>
