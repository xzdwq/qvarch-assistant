<script setup lang="ts">
import Icon from '../Icon.vue'

/** A recording going on, right where it will be in the note: the time, the level, «Остановить». */
const props = defineProps<{ sec: number; level: number; onStop: () => void }>()
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
</script>

<template>
  <div class="rc tw:inline-flex tw:items-center tw:gap-10 tw:max-w-full tw:pt-6 tw:pr-8 tw:pb-6 tw:pl-12 tw:border tw:border-stop/50 tw:rounded-[10px] tw:bg-stop/8 tw:text-[12.5px] tw:whitespace-nowrap">
    <span class="dot tw:w-9 tw:h-9 tw:rounded-[50%] tw:bg-stop tw:animate-[BlockRecording-blink_1s_infinite]"></span>
    <b class="tw:min-w-36 tw:text-text-hi tw:font-data">{{ fmt(props.sec) }}</b>
    <span class="meter tw:w-90 tw:h-6 tw:rounded-[3px] tw:bg-panel-3 tw:overflow-hidden"><i class="tw:block tw:h-full tw:bg-stop tw:[transition:width_0.08s]" :style="{ width: `${Math.round(props.level * 100)}%` }"></i></span>
    <span class="muted tw:overflow-hidden tw:text-muted tw:text-ellipsis">Идёт запись — запись встанет здесь</span>
    <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-[6px] tw:bg-stop tw:text-white tw:text-[12px] tw:hover:enabled:brightness-110" @mousedown.prevent @click="props.onStop()"><Icon name="stop" :size="11" />Остановить</button>
  </div>
</template>
