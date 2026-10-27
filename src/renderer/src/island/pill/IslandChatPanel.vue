<script setup lang="ts">
import { ISLAND_DRAWERS } from '@shared/tracker/islandGeometry'
import Icon from '../../components/Icon.vue'
import IslandChatView from '../chat/IslandChatView.vue'
import { useIsland } from '../islandState'

/**
 * The chat next to the pill (the orb or the unread count opens it): a room's whole chat; «Заметка» — the orb opens
 * the quick note again.
 */
const { chat, switchOrb } = useIsland()
const { open } = chat
const height = `${ISLAND_DRAWERS.chat.h - 8}px`
</script>

<template>
  <IslandChatView
    v-if="open"
    class="tw:absolute tw:left-10 tw:right-10 tw:top-full tw:animate-[Island-nslide_0.3s_cubic-bezier(0.32,0.72,0,1)_0.05s_both] tw:group-[.up]/stage:top-auto tw:group-[.up]/stage:bottom-full tw:group-[.up]/stage:pt-6"
    :style="{ height }"
    @click.stop
  >
    <template #lead>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-white/12 tw:rounded-full tw:bg-transparent tw:text-muted tw:text-[11px] tw:hover:text-text" title="Сфера открывает быструю заметку" @click="switchOrb('note')"><Icon name="note" :size="12" />Заметка</button>
    </template>
  </IslandChatView>
</template>
