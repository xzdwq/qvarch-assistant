<script setup lang="ts">
import { computed } from 'vue'
import { cellText, type Grid } from '../lib/grid'
import Icon from './Icon.vue'
import ContextMenu from './ContextMenu.vue'

/** The notebook's table of values (its state — `useGrid`): scrolls inside both ways, never widens the note. */
const props = defineProps<{ grid: Grid; maxHeight?: number }>()
const g = props.grid
/** The rows' numbers' column (a click on a number — its row). */
const NUM_W = 44
const width = computed(() => NUM_W + g.widths.value.reduce((s, w) => s + w, 0))
const setBox = (el: unknown) => (g.box.value = (el as HTMLElement | null) ?? undefined)
</script>

<template>
  <p v-if="g.exported.value" class="muted saved tw:text-muted tw:my-4 tw:mx-10 tw:text-[12px] tw:break-all">{{ g.exported.value }}</p>
  <div v-if="g.data.value" :ref="setBox" class="dg tw:overflow-auto tw:contain-[inline-size] tw:focus:outline-none" tabindex="0" :style="{ maxHeight: `${maxHeight ?? 420}px` }" @keydown="g.onKey">
    <table class="tw:table-fixed tw:border-separate tw:[border-spacing:0] tw:font-data tw:text-[12px]" :style="{ width: `${width}px` }">
      <colgroup>
        <col :style="{ width: `${NUM_W}px` }" />
        <col v-for="(w, i) in g.widths.value" :key="i" :style="{ width: `${w}px` }" />
      </colgroup>
      <thead>
        <tr>
          <th class="num tw:overflow-hidden tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:text-ellipsis tw:whitespace-nowrap tw:select-none tw:top-0 tw:font-semibold tw:align-top tw:sticky tw:left-0 tw:py-5 tw:px-6 tw:bg-panel-2 tw:text-muted tw:text-right tw:cursor-pointer tw:z-2" title="Выделить всё (Ctrl+A) · Ctrl+C — копировать выделенное" @click="g.pickAll">#</th>
          <th class="tw:py-5 tw:px-10 tw:overflow-hidden tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:text-left tw:text-ellipsis tw:whitespace-nowrap tw:select-none tw:sticky tw:z-1 tw:top-0 tw:[&&]:pr-12 tw:bg-panel-2 tw:text-text-hi tw:font-semibold tw:align-top tw:cursor-pointer tw:[&.picked]:[box-shadow:var(--shadow-underline)]" v-for="(c, i) in g.data.value.columns" :key="i" :class="{ picked: g.sel.value?.head && g.inSel(0, i) }" :title="`${c.name}${c.type ? ` · ${c.type}` : ''} — клик: выделить колонку (Shift — несколько)`" @click="g.pickCol($event, i)">
            <span class="cn tw:block tw:overflow-hidden tw:text-ellipsis">{{ c.name }}</span><span v-if="c.type" class="ct tw:block tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[10.5px] tw:font-normal">{{ c.type }}</span>
            <i class="rz tw:absolute tw:top-0 tw:-right-3 tw:bottom-0 tw:z-2 tw:w-7 tw:cursor-col-resize tw:hover:bg-accent/35" title="Перетащите — ширина колонки; двойной клик — по содержимому" @pointerdown="g.resize($event, i)" @dblclick="g.fit(i)"></i>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr class="tw:group/g26" v-for="(r, i) in g.shownRows.value" :key="i">
          <td class="num tw:overflow-hidden tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:text-ellipsis tw:whitespace-nowrap tw:select-none tw:group-last/g26:border-b-0 tw:align-top tw:sticky tw:z-1 tw:left-0 tw:py-5 tw:px-6 tw:bg-panel-2 tw:text-muted tw:text-right tw:cursor-pointer tw:group-hover/g26:bg-panel-2 tw:group-hover/g26:text-text-2" title="Выделить строку (Shift — несколько)" @pointerdown="g.pickRow($event, i)">{{ i + 1 }}</td>
          <td class="tw:group/g27 tw:py-5 tw:px-10 tw:overflow-hidden tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:text-left tw:text-ellipsis tw:whitespace-nowrap tw:select-none tw:group-last/g26:border-b-0 tw:group-hover/g26:bg-hover tw:align-top tw:[&.nul]:text-muted tw:[&.nul]:italic tw:[&.sel]:not-group-hover/g26:bg-accent/18 tw:group-hover/g26:[&.sel]:bg-accent/26 tw:[&.open]:relative tw:[&.open]:whitespace-normal" v-for="(v, j) in r" :key="j" :class="{ nul: v === null, sel: g.inSel(i, j), open: g.unfolded.value.has(`${i}:${j}`) }" :title="!g.unfolded.value.has(`${i}:${j}`) && cellText(v).length > 60 ? cellText(v).slice(0, 2000) : undefined" @pointerdown="g.cellDown($event, i, j)" @pointerenter="g.cellEnter(i, j)" @contextmenu="g.onCellMenu($event, i, j)">
            <template v-if="g.jsonCells.value[i]?.[j]">
              <button class="jt tw:inline-grid tw:place-items-center tw:w-16 tw:h-16 tw:mt-0 tw:mr-4 tw:mb-0 tw:-ml-4 tw:p-0 tw:border-0 tw:rounded-[3px] tw:bg-transparent tw:text-accent-fg tw:[vertical-align:-3px] tw:hover:bg-hover tw:group-[.open]/g27:absolute tw:group-[.open]/g27:top-5 tw:group-[.open]/g27:left-6 tw:group-[.open]/g27:m-0 tw:hover:enabled:border-border-3" :title="g.unfolded.value.has(`${i}:${j}`) ? 'Свернуть JSON' : 'Развернуть JSON'" @pointerdown.stop @click.stop="g.toggleJson(i, j)"><Icon name="chevronRight" :size="11" :style="g.unfolded.value.has(`${i}:${j}`) ? 'transform: rotate(90deg)' : ''" /></button>
              <pre v-if="g.unfolded.value.has(`${i}:${j}`)" class="jv tw:group-[.open]/g27:mt-0 tw:group-[.open]/g27:mr-0 tw:group-[.open]/g27:mb-0 tw:group-[.open]/g27:ml-14 tw:max-h-320 tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:overflow-auto tw:text-text tw:text-[11.5px] tw:leading-[1.45] tw:whitespace-pre tw:select-text tw:cursor-text" @pointerdown.stop>{{ g.prettyJson(v) }}</pre>
              <template v-else>{{ cellText(v) }}</template>
            </template>
            <template v-else>{{ v === null ? 'NULL' : cellText(v) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="g.data.value.rows.length > g.limit" class="muted more tw:text-muted tw:my-6 tw:mx-8 tw:text-[12px]">Показаны первые {{ g.limit }} из {{ g.data.value.rows.length }} — все строки в экспорте, в выделении колонок и в переменной.</p>
  </div>
  <ContextMenu v-if="g.cellMenu.value" :x="g.cellMenu.value.x" :y="g.cellMenu.value.y" :items="g.cellItems.value" @close="g.cellMenu.value = undefined" />
</template>
