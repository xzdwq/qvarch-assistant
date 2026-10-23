<script setup lang="ts">
/** The presets: run one (a click), edit / remove it, reorder by the handle. */
import { ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { useConfigListReorder } from './useConfigListReorder'
import { useTermView } from './termViewContext'

const { config, runner, presets } = useTermView()
const { cfg } = config
const { runPreset } = runner
const { addPreset, edit, removePreset } = presets
const listEl = ref<HTMLElement>()
const { dragId, startDrag } = useConfigListReorder(config, 'presets', listEl)
</script>

<template>
        <div class="psh tw:flex tw:items-center tw:h-32 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-12">
          <span class="cap">Команды</span>
          <span class="grow tw:flex-1"></span>
          <button class="tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg" title="Новый пресет" @click="addPreset"><Icon name="plus" :size="14" /></button>
        </div>
        <div ref="listEl" class="plist tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-0 tw:pr-0 tw:pb-4 tw:pl-0">
          <div v-for="p in cfg.presets" :key="p.id" class="pr tw:group/pr tw:flex tw:items-center tw:min-h-30 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-2 tw:hover:not-[&.drag]:bg-hover tw:[&.drag]:bg-accent-soft tw:[&.drag]:[outline:1px_solid_var(--accent)]" :class="{ drag: dragId === p.id }">
            <span class="grip tw:inline-flex tw:py-4 tw:px-3 tw:text-dim tw:cursor-grab tw:touch-none" title="Перетащить" @pointerdown="startDrag($event, p.id)"><Icon name="grip" :size="12" /></span>
            <button class="prun tw:group/prun tw:flex-1 tw:min-w-0 tw:flex tw:items-center tw:gap-7 tw:self-stretch tw:py-0 tw:px-4 tw:border-0 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="p.cmd" @click="runPreset(p)">
              <Icon :name="p.run ? 'play' : 'pencil'" :size="11" class="pi tw:[&&]:flex-none tw:text-up-fg tw:[&.type]:text-warn-fg" :class="{ type: !p.run }" />
              <span class="pn tw:group-hover/prun:text-accent-fg tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ p.name }}</span>
            </button>
            <span class="pacts tw:hidden tw:group-hover/pr:inline-flex">
              <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi" title="Изменить" @click="edit(p)"><Icon name="pencil" :size="11" /></button>
              <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi" title="Удалить" @click="removePreset(p)"><Icon name="trash" :size="11" /></button>
            </span>
          </div>
          <p v-if="!cfg.presets.length" class="none tw:my-10 tw:mx-12 tw:text-muted tw:text-[11.5px]">Пресетов нет — «+» сверху</p>
        </div>
</template>
