<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { besidePlace, openWhile } from '@renderer/lib/usePopover'
import type { Align, TableModel } from './model'

/**
 * A column's ▾ menu (insert, align, sort, sum, delete) and a row's handle menu (insert, delete): over everything,
 * kept by the button it opened from (the page scrolled), closed when that is out of sight or on a click elsewhere.
 */
defineProps<{ table: TableModel }>()
const emit = defineEmits<{
  addCol: [at: number]
  delCol: [at: number]
  addRow: [at: number]
  delRow: [at: number]
  align: [c: number, a: Align]
  sort: [c: number, dir: 1 | -1]
  sum: [c: number]
}>()

const menu = ref<{ kind: 'col' | 'row'; i: number }>()
const menuOpen = openWhile(menu)
/** The button the menu opened from (the menu stays by it). */
const menuAnchor = ref<HTMLElement>()
const MENU_W = 250
const menuPlace = besidePlace(MENU_W, 330)
/** Opened by a column's ▾ or a row's handle. */
function open(kind: 'col' | 'row', i: number, e: MouseEvent): void {
  menuAnchor.value = e.currentTarget as HTMLElement
  menu.value = { kind, i }
}
/** The action done, the menu closed. */
function act(fn: () => void): void {
  fn()
  menu.value = undefined
}
defineExpose({ open })
</script>

<template>
  <Popover v-model:open="menuOpen" :anchor="menuAnchor" :place="menuPlace" class="bt-menu tw:fixed tw:z-5000 tw:flex tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" :style="{ width: `${MENU_W}px` }">
    <template v-if="menu">
      <template v-if="menu.kind === 'col'">
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" @click="act(() => emit('addCol', menu!.i))"><Icon name="chevronLeft" :size="13" />Вставить слева</button>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" @click="act(() => emit('addCol', menu!.i + 1))"><Icon name="chevronRight" :size="13" />Вставить справа</button>
        <hr class="tw:my-4 tw:mx-0 tw:border-0 tw:[&&]:border-t tw:[&&]:border-t-border" />
        <div class="bt-al tw:flex tw:items-center tw:gap-2 tw:py-2 tw:px-8 tw:text-text-2 tw:text-[12px]">
          <span class="tw:flex-1">Выравнивание</span>
          <button class="tw:flex tw:items-center tw:gap-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40 tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !table.align[menu.i] || table.align[menu.i] === 'left' }" title="По левому краю" @click="act(() => emit('align', menu!.i, undefined))">⇤</button>
          <button class="tw:flex tw:items-center tw:gap-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40 tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: table.align[menu.i] === 'center' }" title="По центру" @click="act(() => emit('align', menu!.i, 'center'))">↔</button>
          <button class="tw:flex tw:items-center tw:gap-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40 tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: table.align[menu.i] === 'right' }" title="По правому краю" @click="act(() => emit('align', menu!.i, 'right'))">⇥</button>
        </div>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" :disabled="!!table.merges?.length" :title="table.merges?.length ? 'В таблице есть объединённые ячейки' : ''" @click="act(() => emit('sort', menu!.i, 1))"><Icon name="sort" :size="13" />Сортировать по возрастанию</button>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" :disabled="!!table.merges?.length" :title="table.merges?.length ? 'В таблице есть объединённые ячейки' : ''" @click="act(() => emit('sort', menu!.i, -1))"><Icon name="sort" :size="13" />Сортировать по убыванию</button>
        <button class="tw:[&.on]:text-accent-fg tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" :class="{ on: table.sums?.includes(menu.i) }" @click="act(() => emit('sum', menu!.i))"><span class="bt-sig tw:w-13 tw:font-bold tw:text-center">Σ</span>{{ table.sums?.includes(menu.i) ? 'Убрать сумму' : 'Сумма по столбцу' }}</button>
        <hr class="tw:my-4 tw:mx-0 tw:border-0 tw:[&&]:border-t tw:[&&]:border-t-border" />
        <button class="danger tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:text-down-fg tw:disabled:opacity-40" :disabled="table.head.length <= 1" @click="act(() => emit('delCol', menu!.i))"><Icon name="trash" :size="13" />Удалить столбец</button>
      </template>
      <template v-else>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" @click="act(() => emit('addRow', menu!.i))"><Icon name="chevronDown" :size="13" style="transform: rotate(180deg)" />Вставить выше</button>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" @click="act(() => emit('addRow', menu!.i + 1))"><Icon name="chevronDown" :size="13" />Вставить ниже</button>
        <hr class="tw:my-4 tw:mx-0 tw:border-0 tw:[&&]:border-t tw:[&&]:border-t-border" />
        <button class="danger tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:text-down-fg tw:disabled:opacity-40" @click="act(() => emit('delRow', menu!.i))"><Icon name="trash" :size="13" />Удалить строку</button>
      </template>
    </template>
  </Popover>
</template>
