<script setup lang="ts">
/** The reactions: on / off, edit (a click), remove, reorder by the handle. */
import { ref } from 'vue'
import { watchPatternsShort as patternsShort } from '@shared/terminalEdit'
import Icon from '../../components/Icon.vue'
import { useConfigListReorder } from './useConfigListReorder'
import { useTermView } from './termViewContext'

const { config, watches } = useTermView()
const { cfg } = config
const { addWatch, editWatch, toggleWatch, removeWatch } = watches
const listEl = ref<HTMLElement>()
const { dragId, startDrag } = useConfigListReorder(config, 'watches', listEl)
</script>

<template>
        <div class="psh tw:flex tw:items-center tw:h-32 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-12">
          <span class="cap">Реакции на вывод</span>
          <span class="grow tw:flex-1"></span>
          <button class="tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg" title="Новая реакция" @click="addWatch"><Icon name="plus" :size="14" /></button>
        </div>
        <div ref="listEl" class="plist tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-0 tw:pr-0 tw:pb-4 tw:pl-0">
          <div v-for="w in cfg.watches" :key="w.id" class="pr var tw:group/pr tw:flex tw:items-center tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-2 tw:min-h-42 tw:hover:not-[&.drag]:bg-hover tw:[&.drag]:bg-accent-soft tw:[&.drag]:[outline:1px_solid_var(--accent)] tw:[&.off]:opacity-50" :class="{ drag: dragId === w.id, off: !w.on }">
            <span class="grip tw:inline-flex tw:py-4 tw:px-3 tw:text-dim tw:cursor-grab tw:touch-none" title="Перетащить" @pointerdown="startDrag($event, w.id)"><Icon name="grip" :size="12" /></span>
            <i class="wdot tw:flex-none tw:w-8 tw:h-8 tw:mt-0 tw:mr-2 tw:mb-0 tw:ml-3 tw:rounded-[2px]" :style="{ background: w.color }"></i>
            <button class="prun col tw:group/prun tw:flex-1 tw:min-w-0 tw:flex tw:self-stretch tw:py-0 tw:px-4 tw:border-0 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:flex-col tw:items-stretch tw:justify-center tw:gap-2 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="editWatch(w)">
              <span class="vn tw:flex tw:items-center tw:gap-6 tw:min-w-0"><b class="tw:group-hover/prun:text-accent-fg tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-data tw:font-semibold tw:text-[12px]">{{ w.name }}</b><em class="tw:flex-none tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:text-muted tw:text-[10px] tw:not-italic" v-if="w.ignoreCase">aA</em><em class="tw:flex-none tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:text-muted tw:text-[10px] tw:not-italic" v-if="w.word">слово</em></span>
              <span class="vv tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text-2 tw:font-data tw:text-[11px]">{{ patternsShort(w) }}</span>
            </button>
            <input type="checkbox" class="won tw:flex-none tw:my-0 tw:mx-4" :checked="w.on" :title="w.on ? 'Включена' : 'Выключена'" @change="toggleWatch(w, ($event.target as HTMLInputElement).checked)" />
            <span class="pacts tw:hidden tw:group-hover/pr:inline-flex">
              <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi" title="Удалить" @click="removeWatch(w)"><Icon name="trash" :size="11" /></button>
            </span>
          </div>
          <p v-if="!cfg.watches.length" class="none tw:my-10 tw:mx-12 tw:text-muted tw:text-[11.5px]">Реакций нет — «+» сверху</p>
        </div>
        <p class="note tw:my-10 tw:mx-12 tw:text-muted tw:text-[11.5px] tw:flex-none tw:[&&]:mt-4">Совпадение в выводе любой оболочки — уведомление справа и мигание TERMINAL внизу, пока уведомление не закрыто.</p>
</template>
