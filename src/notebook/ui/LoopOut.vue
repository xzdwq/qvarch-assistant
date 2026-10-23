<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RunnableKind } from '@nb/blocks/specs'
import type { LoopOutMode } from '@nb/domain/blockInfo'
import { accGrid, accText, noteRun, passTitle, passValue, pickPass } from '@nb/engine'
import { useFold } from '@renderer/lib/foldState'
import { useGrid } from '@renderer/lib/grid'
import { copyMd } from '@renderer/lib/copyMd'
import DataGrid from '@renderer/components/DataGrid.vue'
import Icon from '@renderer/components/Icon.vue'
import Markdown from '@renderer/components/Markdown.vue'
import MenuButton from '@renderer/components/MenuButton.vue'
import RunView from './RunView.vue'
import { BLOCK_VIEWS } from './blockViews'

/**
 * A block inside a loop, under it: its results over the loop's passes, shown one of three ways (kept in the block's
 * line — `out=`): one pass at a time (the block shows it; ‹ › — another), all together (one table / one text),
 * each apart (a result per pass, one under another). A template — its texts together only (folded or open).
 */
const props = defineProps<{ path: string; loopKey: string; kind: RunnableKind; blockKey: string; name?: string; out?: LoopOutMode; onMode: (out: LoopOutMode | undefined) => void }>()
const lr = computed(() => noteRun(props.path).loops[props.loopKey])
/** How a pass's result reads (a text, rows, an answer, a value). */
const shape = computed(() => BLOCK_VIEWS[props.kind].passResult)
/** A text per pass (a template): its texts are shown together, always. */
const tpl = computed(() => shape.value === 'markdown')
/** How it is shown: a template — together, always. */
const mode = computed(() => (tpl.value ? 'acc' : props.out))
const open = useFold(() => `${props.path}#${props.blockKey}#loop`, true)
const passes = computed(() => lr.value?.passes ?? [])
const cur = computed(() => lr.value?.sel ?? passes.value.length - 1)
const go = (d: number) => pickPass(props.path, props.loopKey, Math.min(passes.value.length - 1, Math.max(0, cur.value + d)))

// ---------- all together ----------
const acc = computed(() => (mode.value === 'acc' && !tpl.value ? accGrid(props.kind, passes.value, props.blockKey, props.name) : undefined))
const grid = useGrid(acc, () => props.name ?? 'Цикл')
const text = computed(() => (tpl.value ? accText(props.kind, passes.value, props.blockKey, props.name) : ''))
const copied = ref(false)
async function copyText(): Promise<void> {
  await copyMd(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// ---------- each apart ----------
const PAGE = 30
const limit = ref(PAGE)
const eachList = computed(() => (mode.value === 'each' ? passes.value.slice(0, limit.value) : []))
</script>

<template>
  <div v-if="lr" class="lo tw:mt-4 tw:border tw:border-border tw:rounded-[8px] tw:bg-bg tw:contain-[inline-size] tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border">
    <div class="lo-bar tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:py-3 tw:px-6 tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border">
      <template class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-if="tpl">
        <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :title="open ? 'Свернуть' : 'Показать'" @mousedown.prevent @click="open = !open"><Icon class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <b class="tt tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:text-text-2 tw:font-semibold">Тексты проходов</b>
      </template>
      <Icon class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-else name="repeat" :size="12" />
      <span v-if="!tpl" class="seg tw:inline-flex tw:flex-none tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden" title="Как показать результаты проходов цикла">
        <button class="tw:h-22 tw:py-0 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !out }" title="По одному проходу: блок показывает выбранный проход (‹ › — другой); «Выполнить» у блока — повторить этот проход" @mousedown.prevent @click="onMode(undefined)">Проход</button>
        <button class="tw:h-22 tw:py-0 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: out === 'acc' }" :title="tpl ? 'Все тексты одним — подряд, через пустую строку' : 'Все проходы одной таблицей: № прохода, его значения, результат'" @mousedown.prevent @click="onMode('acc')">Вместе</button>
        <button class="tw:h-22 tw:py-0 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: out === 'each' }" title="Результат каждого прохода отдельно, один под другим" @mousedown.prevent @click="onMode('each')">Каждый</button>
      </span>
      <template class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-if="!mode && passes.length">
        <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :disabled="cur <= 0" title="Предыдущий проход" @mousedown.prevent @click="go(-1)"><Icon class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" name="chevronLeft" :size="12" /></button>
        <span class="pn tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:min-w-0 tw:overflow-hidden tw:text-text-2 tw:font-data tw:text-ellipsis" :title="passes[cur] ? passTitle(passes[cur]) : ''">{{ passes[cur] ? passTitle(passes[cur]) : '' }} <span class="muted tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:text-muted">из {{ passes.length }}</span></span>
        <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :disabled="cur >= passes.length - 1" title="Следующий проход" @mousedown.prevent @click="go(1)"><Icon class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" name="chevronRight" :size="12" /></button>
      </template>
      <span v-else class="muted tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:text-muted">{{ tpl ? '·' : 'проходов' }} {{ passes.length }}{{ lr.state === 'run' ? '…' : '' }}</span>
      <span class="grow tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:flex-1"></span>
      <template class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-if="mode === 'acc'">
        <button v-if="tpl" class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :disabled="!text" :title="copied ? 'Скопировано' : 'Копировать все тексты: с оформлением и как Markdown'" @mousedown.prevent @click="copyText"><Icon class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" :name="copied ? 'check' : 'copy'" :size="13" /></button>
        <template class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-else>
          <span v-if="grid.copied.value" class="muted tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:text-muted">скопировано</span>
          <span v-else-if="grid.selCount.value > 1" class="muted tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:text-muted">выделено {{ grid.selCount.value }}</span>
          <MenuButton class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" icon="download" title="Все проходы: скопировать или сохранить в Excel / CSV" :width="240" :items="grid.exportItems.value" />
        </template>
      </template>
    </div>
    <template class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-if="mode === 'acc'">
      <template class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-if="tpl"><Markdown v-if="open" class="lo-md tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:py-6 tw:px-12 tw:select-text" :text="text || '_Текстов пока нет_'" /></template>
      <DataGrid class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" v-else-if="acc && acc.rows.length" :grid="grid" />
      <p v-else class="muted pad tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:text-muted tw:my-6 tw:mx-10">Проходы ничего не дали.</p>
    </template>
    <div v-else-if="mode === 'each'" class="lo-each tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:flex tw:flex-col tw:max-h-640 tw:overflow-auto">
      <div v-for="p in eachList" :key="p.n" class="lo-it tw:[.lo-bar+&]:not-[.lo-it+&]:border-t tw:[.lo-bar+&]:not-[.lo-it+&]:border-t-border tw:pt-4 tw:pr-8 tw:pb-6 tw:pl-8 tw:border-l-3 tw:border-l-transparent tw:[.lo-it+&]:border-t tw:[.lo-it+&]:border-t-border tw:[&.bad]:border-l-down" :class="{ bad: p.state === 'error' }">
        <div class="lo-ih tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:mb-3 tw:overflow-hidden tw:text-text-2 tw:font-data tw:text-[11.5px] tw:text-ellipsis tw:whitespace-nowrap">{{ passTitle(p) }}<span v-if="p.state === 'run'" class="muted tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:text-muted"> · выполняется…</span></div>
        <RunView class="tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border" :shape="shape" :run="p.runs?.[blockKey] ?? (p.state === 'error' ? { state: 'error', at: p.at, error: p.error } : undefined)" :value="passValue(kind, p, blockKey, name)" />
      </div>
      <button v-if="passes.length > limit" class="more tw:[.lo-bar+&]:border-t tw:[.lo-bar+&]:border-t-border tw:m-6 tw:self-start tw:hover:enabled:border-border-3" @mousedown.prevent @click="limit += PAGE">Ещё {{ Math.min(PAGE, passes.length - limit) }} из {{ passes.length - limit }}</button>
    </div>
  </div>
</template>
