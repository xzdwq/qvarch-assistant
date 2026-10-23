<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import KindMenu from '../../components/KindMenu.vue'
import { useIsland } from '../islandState'

/** The right-click menu: the kinds, plus merge / delete for blocks or done / drop for a plan block. */
const { menu, menuKind, menuBounds, planDoneIds, planMenu, mergeSelected, deleteFromMenu, onMenuPick } = useIsland().menu
</script>

<template>
  <KindMenu
    v-if="menu"
    :x="menu.x"
    :y="menu.y"
    :title="menu.title"
    :current="menuKind"
    :bounds="menuBounds"
    :no-kinds="!!menu.planId"
    @pick="onMenuPick"
    @close="menu = undefined"
  >
    <template v-if="menu.planId">
      <button class="mact tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:bg-transparent tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:bg-hover tw:hover:enabled:not-[.seg2_&]:border-border-3" :disabled="planDoneIds.has(menu.planId)" @click="planMenu('done')"><Icon name="check" :size="14" />{{ planDoneIds.has(menu.planId) ? 'Уже сделано по плану' : 'Сделано по плану' }}</button>
      <button class="mdel tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:bg-transparent tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:text-down-fg tw:hover:bg-down/15 tw:hover:enabled:not-[.seg2_&]:border-border-3" @click="planMenu('delete')"><Icon name="trash" :size="14" />Удалить из плана</button>
    </template>
    <template v-else-if="menu.multi">
      <div class="msep tw:h-1 tw:m-4 tw:bg-border"></div>
      <button class="mact tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:bg-transparent tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:bg-hover tw:hover:enabled:not-[.seg2_&]:border-border-3" @click="mergeSelected"><Icon name="layers" :size="14" />Объединить</button>
      <button class="mdel tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:bg-transparent tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:text-down-fg tw:hover:bg-down/15 tw:hover:enabled:not-[.seg2_&]:border-border-3" @click="deleteFromMenu"><Icon name="trash" :size="14" />Удалить выбранные</button>
    </template>
    <template v-else-if="menu.entryId">
      <div class="msep tw:h-1 tw:m-4 tw:bg-border"></div>
      <button class="mdel tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:bg-transparent tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:text-down-fg tw:hover:bg-down/15 tw:hover:enabled:not-[.seg2_&]:border-border-3" @click="deleteFromMenu"><Icon name="trash" :size="14" />Удалить отрезок</button>
    </template>
  </KindMenu>
</template>
