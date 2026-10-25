<script setup lang="ts">
import { ISLAND_DRAWERS } from '@shared/tracker/islandGeometry'
import Icon from '../../components/Icon.vue'
import { useIsland } from '../islandState'

/** The reminders fired (the latest first): each opens its event in the app; ✕ — seen, all of them. */
const { notices } = useIsland()
const { open, list } = notices
const height = `${ISLAND_DRAWERS.notice.h - 8}px`
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div
    v-if="open"
    class="tw:absolute tw:left-10 tw:right-10 tw:top-full tw:flex tw:flex-col tw:gap-4 tw:cursor-auto tw:animate-[Island-nslide_0.3s_cubic-bezier(0.32,0.72,0,1)_0.05s_both] tw:group-[.up]/stage:top-auto tw:group-[.up]/stage:bottom-full tw:group-[.up]/stage:pt-6"
    :style="{ height }"
    @click.stop
    @pointerenter="notices.hold()"
  >
    <div class="tw:flex tw:items-center tw:gap-6 tw:text-[11px] tw:text-warn-fg tw:whitespace-nowrap">
      <Icon name="bell" :size="12" /><b>Напоминания</b>
      <span class="tw:flex-1"></span>
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:text-text" title="Просмотрено (Esc)" @click="notices.close()"><Icon name="x" :size="12" /></button>
    </div>
    <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4">
      <button
        v-for="n in list"
        :key="n.id"
        class="tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-auto tw:py-6 tw:px-10 tw:border tw:border-warn/25 tw:rounded-[12px] tw:bg-warn/8 tw:text-left tw:hover:bg-warn/14"
        title="Открыть событие в приложении"
        @click="notices.openInApp(n)"
      >
        <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1">
          <b class="tw:text-[12px] tw:text-text tw:truncate">{{ n.text }}</b>
          <span class="tw:text-muted tw:text-[11px]">{{ n.title }} · пришло в {{ hm(n.at) }}</span>
        </span>
        <Icon name="external" :size="12" class="tw:flex-none tw:text-muted" />
      </button>
      <p v-if="!list.length" class="tw:m-6 tw:text-muted tw:text-[12px]">Напоминаний нет</p>
    </div>
  </div>
</template>
