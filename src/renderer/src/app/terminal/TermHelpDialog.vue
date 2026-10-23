<script setup lang="ts">
/** The terminal's guide. */
import Icon from '../../components/Icon.vue'
import Markdown from '../../components/Markdown.vue'
import { TERM_HELP } from '../../lib/termHelp'
import { useTermView } from './termViewContext'

const { helpOpen } = useTermView()
</script>

<template>
      <div v-if="helpOpen" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[12vh] tw:bg-black/55" @mousedown.self="helpOpen = false">
        <div class="tq help tw:flex tw:flex-col tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(820px,calc(100vw-32px))] tw:max-h-[84vh] tw:p-0 tw:gap-0" tabindex="-1" @keydown.esc="helpOpen = false">
          <div class="hh tw:flex tw:items-center tw:justify-between tw:py-10 tw:px-14 tw:border-b tw:border-b-border"><span class="cap">Инструкция · Терминал</span><button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:text-text-2" @click="helpOpen = false"><Icon name="x" :size="14" /></button></div>
          <div class="hb tw:overflow-auto tw:pt-6 tw:pr-20 tw:pb-20 tw:pl-20"><Markdown :text="TERM_HELP" /></div>
        </div>
      </div>
</template>
