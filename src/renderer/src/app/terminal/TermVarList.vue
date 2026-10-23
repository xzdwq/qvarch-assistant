<script setup lang="ts">
/** The variables: one's own (reordered by the handle — each sees those above it) and the built-in ones, with their values for the shell in front; a click copies the insert. */
import { ref } from 'vue'
import { BUILTIN_VARS } from '@shared/terminal'
import { insertOf as insOf } from '@shared/terminalEdit'
import Icon from '../../components/Icon.vue'
import { useConfigListReorder } from './useConfigListReorder'
import { useTermView } from './termViewContext'

const { config, vars } = useTermView()
const { cfg } = config
const { values, loadValues, addVar, editVar, removeVar, copied, copyVar } = vars
/** «{{ shortBranch }}» as text (a mustache inside a mustache would close it). */
const VAR_EX = '{{ shortBranch }}'
const listEl = ref<HTMLElement>()
const { dragId, startDrag } = useConfigListReorder(config, 'vars', listEl, () => void loadValues())
</script>

<template>
        <div class="psh tw:flex tw:items-center tw:h-32 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-12">
          <span class="cap">Переменные</span>
          <span class="grow tw:flex-1"></span>
          <button class="tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg" title="Обновить значения" @click="loadValues"><Icon name="refresh" :size="13" /></button>
          <button class="tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg" title="Новая переменная" @click="addVar"><Icon name="plus" :size="14" /></button>
        </div>
        <div class="vscroll tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pb-8">
          <p class="note top tw:mt-0 tw:mr-12 tw:mb-4 tw:ml-12 tw:text-muted tw:text-[11.5px] tw:flex-none">Значения — для активной оболочки (её папки и ветки). В пресете переменная пишется в двойных фигурных скобках: <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11px]">{{ VAR_EX }}</code>. Клик по строке — скопировать так.</p>
          <div class="vh tw:pt-10 tw:pr-12 tw:pb-4 tw:pl-12 tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Свои</div>
          <div ref="listEl">
            <div v-for="v in cfg.vars" :key="v.id" class="pr var tw:group/pr tw:flex tw:items-center tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-2 tw:min-h-42 tw:hover:not-[&.drag]:bg-hover tw:[&.drag]:bg-accent-soft tw:[&.drag]:[outline:1px_solid_var(--accent)]" :class="{ drag: dragId === v.id }">
              <span class="grip tw:inline-flex tw:py-4 tw:px-3 tw:text-dim tw:cursor-grab tw:touch-none" title="Перетащить (порядок важен: переменная видит те, что выше)" @pointerdown="startDrag($event, v.id)"><Icon name="grip" :size="12" /></span>
              <button class="prun col tw:group/prun tw:flex-1 tw:min-w-0 tw:flex tw:self-stretch tw:py-0 tw:px-4 tw:border-0 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:flex-col tw:items-stretch tw:justify-center tw:gap-2 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="`${v.value}\nКлик — скопировать ${insOf(v.name)}`" @click="copyVar(v.name)">
                <span class="vn tw:flex tw:items-center tw:gap-6 tw:min-w-0"><b class="tw:group-hover/prun:text-accent-fg tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-data tw:font-semibold tw:text-[12px]">{{ v.name }}</b><em class="tw:flex-none tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:text-muted tw:text-[10px] tw:not-italic">{{ v.js ? 'формула' : 'текст' }}</em><em v-if="copied === v.name" class="ok tw:flex-none tw:py-0 tw:px-4 tw:rounded-r1 tw:text-[10px] tw:not-italic tw:bg-up/14 tw:text-up-fg">скопировано</em></span>
                <span v-if="values[v.name]?.error" class="vv bad tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-data tw:text-[11px] tw:text-down-fg">{{ values[v.name].error }}</span>
                <span v-else class="vv tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text-2 tw:font-data tw:text-[11px] tw:[&.empty]:text-warn-fg tw:[&.empty]:italic" :class="{ empty: values[v.name]?.value === '' }">{{ values[v.name]?.value === '' ? 'пусто здесь' : (values[v.name]?.value ?? '…') }}</span>
              </button>
              <span class="pacts tw:hidden tw:group-hover/pr:inline-flex">
                <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi" title="Изменить" @click="editVar(v)"><Icon name="pencil" :size="11" /></button>
                <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi" title="Удалить" @click="removeVar(v)"><Icon name="trash" :size="11" /></button>
              </span>
            </div>
          </div>
          <p v-if="!cfg.vars.length" class="none tw:my-10 tw:mx-12 tw:text-muted tw:text-[11.5px]">Своих переменных нет — «+» сверху.</p>
          <div class="vh tw:pt-10 tw:pr-12 tw:pb-4 tw:pl-12 tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Встроенные <span class="tw:normal-case tw:tracking-[0]">(считаются сами)</span></div>
          <div v-for="b in BUILTIN_VARS" :key="b.name" class="pr var tw:flex tw:items-center tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-2 tw:min-h-42 tw:hover:bg-hover">
            <button class="prun col bi tw:group/prun tw:flex-1 tw:min-w-0 tw:flex tw:self-stretch tw:border-0 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:flex-col tw:items-stretch tw:justify-center tw:gap-2 tw:pt-6 tw:pr-4 tw:pb-6 tw:pl-22 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="`${b.desc}\nКлик — скопировать ${insOf(b.name)}`" @click="copyVar(b.name)">
              <span class="vn tw:flex tw:items-center tw:gap-6 tw:min-w-0"><b class="tw:group-hover/prun:text-accent-fg tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-data tw:font-semibold tw:text-[12px]">{{ b.name }}</b><em v-if="copied === b.name" class="ok tw:flex-none tw:py-0 tw:px-4 tw:rounded-r1 tw:text-[10px] tw:not-italic tw:bg-up/14 tw:text-up-fg">скопировано</em><em v-if="cfg.vars.some((v) => v.name === b.name)" class="warn tw:flex-none tw:py-0 tw:px-4 tw:rounded-r1 tw:text-[10px] tw:not-italic tw:bg-warn/14 tw:text-warn-fg">заменена своей</em></span>
              <span class="vd tw:text-muted tw:text-[11px] tw:whitespace-normal">{{ b.desc }}</span>
              <span class="vv tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text-2 tw:font-data tw:text-[11px] tw:[&.empty]:text-warn-fg tw:[&.empty]:italic" :class="{ empty: values[b.name]?.value === '' }">{{ values[b.name]?.value === '' ? 'пусто здесь' : (values[b.name]?.value ?? '…') }}</span>
            </button>
          </div>
        </div>
</template>
