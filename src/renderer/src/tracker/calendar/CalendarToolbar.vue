<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { useCalendarState } from './useTaskCalendar'

/** The calendar's toolbar: today, the range shown, new event / note, search, productive only, zoom presets. */
const { goToday, rangeText, addEvent, addNote, q, onlyProductive, PRESETS, nearPreset, zoomTo } = useCalendarState()
</script>

<template>
  <div class="bar tw:flex tw:items-center tw:flex-wrap tw:gap-6">
    <button class="btoday tw:py-4 tw:px-12 tw:text-[13px]" @click="goToday">Сегодня</button>
    <span class="ttl tw:ml-8 tw:text-[17px] tw:font-semibold">{{ rangeText }}</span>
    <span class="grow tw:flex-1"></span>
    <button class="add tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-10 tw:text-[12px]" title="Новое событие" @click="addEvent"><Icon name="plus" :size="13" />Событие</button>
    <button class="add note tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-10 tw:text-[12px] tw:text-warn-fg" title="Новая заметка" @click="addNote"><Icon name="note" :size="13" />Заметка</button>
    <input v-model="q" class="search tw:w-140 tw:py-4 tw:px-8 tw:text-[12px]" placeholder="Поиск" spellcheck="false" />
    <button class="tog tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-10 tw:rounded-r2 tw:border tw:border-border tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-text tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: onlyProductive }" title="Только продуктивные виды" @click="onlyProductive = !onlyProductive">Продуктивные</button>
    <span class="seg tw:inline-flex tw:p-2 tw:rounded-[4px] tw:bg-white/5" title="Масштаб — или Ctrl + колесо мыши">
      <button class="tw:py-3 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-white/10 tw:[&.on]:text-text" v-for="p in PRESETS" :key="p.days" :class="{ on: nearPreset === p.days }" @click="zoomTo(p.days)">{{ p.label }}</button>
    </span>
  </div>
</template>
