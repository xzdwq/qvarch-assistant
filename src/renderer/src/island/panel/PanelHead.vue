<script setup lang="ts">
import { formatDuration } from '@shared/timeline'
import ActivityWave from '../../components/ActivityWave.vue'
import Icon from '../../components/Icon.vue'
import { useIsland } from '../islandState'

/**
 * The panel's header: the move handle with the logo (a native drag region), date, activity, productive time,
 * status; new note, pin expanded, open the app. A click on the header itself resets the selection.
 */
const { island, day, pick, expand, openMain } = useIsland()
const { ui } = island
const { dateText, productive, status } = day
const { panelNote, openPanelNote, resetSelection } = pick
const { pinned, togglePin } = expand

// the handle and the title are -webkit-app-region: drag — such areas get no DOM events
function onHeadClick(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest('button, input, .nodrag')) resetSelection()
}
</script>

<template>
  <div class="head tw:relative tw:z-20 tw:select-none tw:flex tw:items-center tw:gap-8 tw:mt-0 tw:-mr-16 tw:mb-8 tw:-ml-16 tw:pt-7 tw:pr-12 tw:pb-6 tw:pl-7 tw:border-b tw:border-b-border" @click="onHeadClick">
    <span class="drag dragzone tw:[-webkit-app-region:drag] tw:flex tw:items-center tw:gap-8 tw:pr-6 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" title="Переместить">
      <span class="handle tw:cursor-move tw:flex-none tw:flex tw:items-center tw:justify-center tw:w-32 tw:h-32 tw:rounded-[4px] tw:text-dim tw:bg-white/4 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"><Icon name="grip" :size="16" /></span>
      <Icon name="qlogo" :size="18" :stroke="3.6" class="logo tw:text-accent" />
      <b>Qvarch</b>
    </span>
    <span v-if="ui.island.date" class="muted small tw:text-[11px] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ dateText }}</span>
    <ActivityWave v-if="ui.island.wave" class="hwave tw:flex-[1_1_0] tw:[&&]:w-0 tw:min-w-60 tw:[&&]:h-18 tw:my-0 tw:mx-8" title="Активность" />
    <span class="total tw:tabular-nums tw:font-data tw:text-text-2 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" title="Продуктивное время"><small class="tw:text-muted tw:text-[10px]">в работе</small> {{ formatDuration(productive) }}</span>
    <span class="status tw:[&.handle]:cursor-move tw:[&.handle]:not-[&.pfill]:not-[&.pwave]:flex-none tw:[&.handle]:not-[.abar_&]:flex tw:[&.handle]:items-center tw:[&.handle]:justify-center tw:[&.handle]:not-[&.pwave]:w-32 tw:[&.handle]:not-[&.pwave]:not-[.abar_&]:h-32 tw:[&.handle]:not-[&.work]:not-[&.call]:text-dim tw:[&.handle]:not-[&.work]:not-[&.call]:bg-white/4 tw:[&.pfill]:not-[&.pwave]:flex-1 tw:[&.pwave]:flex-[1_1_0] tw:[&.pwave]:w-0 tw:[&.pwave]:min-w-20 tw:[&.pwave]:not-[.abar_&]:h-14 tw:py-2 tw:px-10 tw:rounded-r2 tw:text-[12px] tw:font-semibold tw:[transition:background_0.3s,color_0.3s] tw:[&.work]:not-[&.call]:bg-up/15 tw:[&.work]:not-[&.call]:text-up tw:[&.call]:bg-[color-mix(in_srgb,var(--call-mark)_18%,transparent)] tw:[&.call]:text-(--call-mark-fg) tw:[&.uncut]:not-[.abar_&]:rounded-r2 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2 tw:[&.empty]:m-6 tw:[&.empty]:text-[12px]" :class="status.cls">{{ status.text }}</span>
    <button class="icon tw:inline-flex tw:items-center tw:bg-transparent tw:border-0 tw:py-4 tw:px-5 tw:text-muted tw:hover:not-[&.on]:text-text-hi tw:[&.on]:text-accent-fg tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent" :class="{ on: !!panelNote }" title="Новая заметка" @click="openPanelNote()"><Icon name="note" :size="15" /></button>
    <button class="icon tw:inline-flex tw:items-center tw:bg-transparent tw:border-0 tw:py-4 tw:px-5 tw:text-muted tw:hover:not-[&.on]:text-text-hi tw:[&.on]:text-accent-fg tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent" :class="{ on: pinned }" :title="pinned ? 'Открепить' : 'Закрепить развёрнутым'" @click="togglePin">
      <Icon name="pin" :size="15" />
    </button>
    <button class="icon tw:inline-flex tw:items-center tw:bg-transparent tw:border-0 tw:py-4 tw:px-5 tw:text-muted tw:hover:text-text-hi tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent" title="Открыть приложение" @click="openMain()"><Icon name="external" :size="15" /></button>
  </div>
</template>

<style scoped src="./PanelHead.css"></style>
