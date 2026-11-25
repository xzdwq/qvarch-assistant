<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import type { BPane } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/** A pane's search on its page (Ctrl+F): the text, «n / of», the previous / next match, closed by Esc. */
defineProps<{ p: BPane }>()
const { find, inputs, closeFind, onFindInput, onFindKey, step } = useBrowserView().find
</script>

<template>
  <div v-if="find.pane === p.id" class="tw:flex-none tw:flex tw:items-center tw:gap-2 tw:h-34 tw:py-0 tw:pr-6 tw:pl-10 tw:border-b tw:border-b-border tw:bg-panel">
    <Icon name="search" :size="13" class="tw:flex-none tw:text-muted" />
    <input
      :ref="(el) => el && inputs.set(p.id, el as HTMLInputElement)"
      class="tw:flex-1 tw:min-w-0 tw:max-w-360 tw:h-26 tw:py-0 tw:px-8 tw:ml-4 tw:rounded-r2 tw:text-[12.5px]"
      :value="find.text"
      placeholder="Найти на странице"
      spellcheck="false"
      @input="onFindInput(($event.target as HTMLInputElement).value)"
      @keydown="onFindKey"
    />
    <span class="tw:flex-none tw:min-w-70 tw:px-6 tw:font-data tw:text-[11.5px] tw:whitespace-nowrap" :class="find.text && !find.total ? 'tw:text-down-fg' : 'tw:text-muted'">{{ find.text ? (find.total ? `${find.active} / ${find.total}` : 'нет совпадений') : '' }}</span>
    <button class="tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35" title="Предыдущее (Shift+Enter)" :disabled="!find.total" @click="step(false)"><Icon name="chevronDown" :size="14" class="tw:rotate-180" /></button>
    <button class="tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35" title="Следующее (Enter)" :disabled="!find.total" @click="step(true)"><Icon name="chevronDown" :size="14" /></button>
    <button class="tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text" title="Закрыть (Esc)" @click="closeFind()"><Icon name="x" :size="13" /></button>
  </div>
</template>
