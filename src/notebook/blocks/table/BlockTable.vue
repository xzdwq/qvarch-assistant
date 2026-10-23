<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { columnSum, coveredBy, fmtSum, mergeAt, tableValue } from './model'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import ContextMenu from '@renderer/components/ContextMenu.vue'
import TableTools from './TableTools.vue'
import TableMenu from './TableMenu.vue'
import { useTableDoc } from './useTableDoc'
import { useTableVar } from './useTableVar'
import { useTableEditing } from './useTableEditing'
import { useTableSelection } from './useTableSelection'
import { useColumnWidths } from './useColumnWidths'
import TableImportDialog from './import/TableImportDialog.vue'
import { useTableImport } from './import/useTableImport'
import { useTablePaste } from './import/useTablePaste'

/**
 * A table of the notebook, edited as a table: cells typed into right away (Tab — the next one, Enter — the
 * one below, Shift+Enter — a new line inside the cell); a «+» on the border between two columns / two rows puts
 * one there; a column's right edge is dragged for its width (double click — back to «by the content»); a
 * column's ▾ — insert, align, sort, delete; a row's handle — insert, delete. The file keeps a GFM table, its
 * columns lined up (the widths, the sums, the merged cells — in a comment over it). Cells dragged over (or
 * Shift+click) — merged by the button under the table; a column's ▾ — its sum under it.
 * «Из переменной» (TableTools): filled from a value of the note. Every table is a variable of the note too (its rows as
 * objects — code reads it by its name). Seen as JSON too; copied / saved as Excel or CSV.
 */
const props = defineProps<{ src: string; autofocus?: boolean; path?: string; line?: number }>()
const emit = defineEmits<{ change: [src: string]; exit: [dir: 1 | -1] }>()
const { t, save: saveDoc } = useTableDoc(() => props.src, (md) => emit('change', md))
// ---------- its variable in the note: the name given kept in the file with any edit ----------
const tv = useTableVar(t, () => ({ path: props.path, line: props.line }))
const save = (now?: boolean) => {
  tv.keepName()
  saveDoc(now)
}
const root = ref<HTMLElement>()
const tableEl = ref<HTMLTableElement>()
const menuRef = ref<InstanceType<typeof TableMenu>>()
const { edit, isEdit, leaveCell, focusCell, onKey, setCell, addRow, delRow, addCol, delCol, toggleSum, setAlign, sortBy } = useTableEditing(t, save, root, (dir) => emit('exit', dir))
const { sel, inSel, selCells, cellDown, cellEnter, doMerge, curMerge, doUnmerge, onFocusCell, cellMenu, onCellMenu, cellItems } = useTableSelection(t, save, root, { isEdit, focusCell })
// ---------- cells from outside: a file / the clipboard imported, a spreadsheet's block pasted ----------
const imp = useTableImport(t, save)
useTablePaste(t, save, root, { sel, edit }, imp.offerGrid)
const { fixed, dragWidth, autoWidth, colStyle } = useColumnWidths(t, save, tableEl)

// ---------- a column's sum ----------
const sums = computed(() => (t.value.sums ?? []).map((c) => [c, columnSum(t.value, c)] as const))
const sumOf = (c: number) => sums.value.find(([x]) => x === c)?.[1]
const sumTitle = (c: number) => {
  const x = sumOf(c)
  return x ? `Сумма чисел: ${x.count}${x.skipped ? ` · пропущено нечисловых: ${x.skipped}` : ''}` : ''
}
// ---------- merged cells ----------
const span = (r: number, c: number) => {
  const m = mergeAt(t.value, r, c)
  return m ? { rowspan: m.rs, colspan: m.cs } : {}
}
/** A row's first cell drawn (the others before it are under a merge from above) — the row's handles are there. */
const firstShown = (r: number) => {
  for (let c = 0; c < t.value.head.length; c++) if (!coveredBy(t.value, r, c)) return c
  return -1
}
const openMenu = (kind: 'col' | 'row', i: number, e: MouseEvent) => menuRef.value?.open(kind, i, e)
/** Seen as JSON: its value in the note — the rows as objects (the head — their keys). */
const asJson = ref(false)
const objects = computed(() => tableValue(t.value))
onMounted(() => {
  if (props.autofocus) void focusCell(-1, 0)
})
defineExpose({ focusFirst: () => focusCell(-1, 0), focusLast: () => focusCell(t.value.rows.length - 1, 0) })
</script>

<template>
  <div ref="root" class="bt tw:relative tw:flow-root tw:contain-[inline-size] tw:min-w-0">
    <TableTools v-model:asJson="asJson" :table="t" :path="path" :line="line" :table-var="tv" @commit="save(true)" @import="imp.importFrom" />
    <p v-if="imp.error.value" class="bt-err tw:my-4 tw:text-warn-fg tw:text-[12px]">{{ imp.error.value }}</p>
    <TableImportDialog v-if="imp.book.value" v-model:head-row="imp.headRow.value" :book="imp.book.value" :sheet="imp.sheet.value" :sheet-index="imp.sheetIndex.value" @pick="imp.pickSheet" @apply="imp.apply" @cancel="imp.cancel" />
    <div v-if="asJson" class="bt-json"><CodeArea :model-value="JSON.stringify(objects, null, 2)" lang="json" readonly :min-height="24" /></div>
    <div v-else class="bt-scroll tw:relative tw:max-w-[calc(100%+24px)] tw:mt-0 tw:mr-0 tw:-mb-10 tw:-ml-24 tw:pt-10 tw:pr-12 tw:pb-10 tw:pl-24 tw:pointer-events-none tw:overflow-x-auto">
      <table class="tw:group/g33 tw:pointer-events-auto tw:border-separate tw:[border-spacing:0] tw:border tw:border-border-2 tw:rounded-[8px] tw:text-[0.92em] tw:[&.fixed-cols]:table-fixed tw:[&.fixed-cols]:w-max" ref="tableEl" :class="{ 'fixed-cols': fixed() }">
        <colgroup><col v-for="(_, c) in t.head" :key="c" :style="colStyle(c)" /></colgroup>
        <thead>
          <tr>
            <template v-for="(h, c) in t.head" :key="c">
            <th v-if="!coveredBy(t, -1, c)" v-bind="span(-1, c)" class="tw:group/g36 tw:first:rounded-tl-[7px] tw:last:rounded-tr-[7px] tw:relative tw:min-w-90 tw:max-w-420 tw:group-[.fixed-cols]/g33:min-w-0 tw:group-[.fixed-cols]/g33:max-w-none tw:p-0 tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:align-top tw:last:border-r-0 tw:bg-panel-2" :style="{ textAlign: mergeAt(t, -1, c) ? 'center' : (t.align[c] ?? 'left') }">
              <button class="bt-plus col tw:absolute tw:z-3 tw:inline-flex tw:items-center tw:justify-center tw:w-18 tw:h-18 tw:p-0 tw:border tw:border-border-2 tw:rounded-[50%] tw:bg-pop tw:text-text-2 tw:opacity-0 tw:[transition:opacity_0.1s] tw:-top-9 tw:-right-9 tw:group-hover/g36:opacity-100 tw:hover:border-accent tw:hover:bg-accent tw:hover:text-white" title="Вставить столбец здесь" @mousedown.prevent @click="(addCol(c + 1), focusCell(-1, c + 1))"><Icon name="plus" :size="11" /></button>
              <span class="bt-rz tw:absolute tw:z-2 tw:top-0 tw:-right-4 tw:bottom-0 tw:w-8 tw:cursor-col-resize tw:hover:not-active:[background:linear-gradient(90deg,transparent_3px,rgb(var(--accent-rgb)/0.8)_3px_5px,transparent_5px)] tw:active:[background:linear-gradient(90deg,transparent_3px,rgb(var(--accent-rgb)/0.8)_3px_5px,transparent_5px)]" title="Потяните — ширина столбца · двойной клик — по содержимому" @pointerdown="dragWidth(c, $event)" @dblclick="autoWidth(c)"></span>
              <textarea class="tw:block tw:w-full tw:min-h-0 tw:pt-7 tw:pr-26 tw:pb-7 tw:pl-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:font-[inherit] tw:[&&]:leading-[1.45] tw:resize-none tw:field-sizing-content tw:outline-none tw:text-text-hi tw:[&&]:font-semibold tw:focus:[box-shadow:inset_0_0_0_2px_rgb(var(--accent-rgb)/0.7)]" v-if="isEdit(-1, c)" :data-rc="`-1:${c}`" :value="h" rows="1" spellcheck="false" :style="{ textAlign: t.align[c] ?? 'left' }" @input="setCell(-1, c, ($event.target as HTMLTextAreaElement).value)" @keydown="onKey($event, -1, c)" @focus="onFocusCell(-1, c)" @blur="leaveCell(-1, c)"></textarea>
              <div v-else class="cv tw:min-h-[calc(1.45em+14px)] tw:max-w-420 tw:pt-7 tw:pr-26 tw:pb-7 tw:pl-10 tw:overflow-hidden tw:leading-[1.45] tw:text-ellipsis tw:whitespace-nowrap tw:cursor-text tw:[&.wrap]:whitespace-pre-wrap tw:[&.wrap]:[word-break:break-word] tw:group-[.fixed-cols]/g33:max-w-none tw:text-text-hi tw:font-semibold" :class="{ wrap: t.wrap }" :style="{ textAlign: t.align[c] ?? 'left' }" :title="!t.wrap && h.length > 24 ? h : undefined" @click="focusCell(-1, c)">{{ h || ' ' }}</div>
              <button class="bt-cm tw:absolute tw:top-6 tw:right-4 tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-panel-3 tw:text-text-2 tw:opacity-0 tw:group-hover/g36:not-group-focus-within/g36:opacity-100 tw:group-focus-within/g36:opacity-100 tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Столбец: вставить, выровнять, сортировать, удалить" @mousedown.prevent @click="openMenu('col', c, $event)"><Icon name="chevronDown" :size="12" /></button>
            </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr class="tw:group/g34 tw:relative" v-for="(row, r) in t.rows" :key="r">
            <template v-for="(cell, c) in row" :key="c">
            <td class="tw:group/g32 tw:min-w-90 tw:max-w-420 tw:[&.sel]:bg-accent/16 tw:group-[.fixed-cols]/g33:min-w-0 tw:group-[.fixed-cols]/g33:max-w-none tw:p-0 tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:align-top tw:[&.lastcol]:border-r-0 tw:[&.merged]:align-middle tw:group-last/g34:border-b-0 tw:[&.tolast]:not-group-last/g34:border-b-0" v-if="!coveredBy(t, r, c)" v-bind="span(r, c)" :class="{ sel: inSel(r, c), tolast: (mergeAt(t, r, c)?.rs ?? 1) + r === t.rows.length, lastcol: c + (mergeAt(t, r, c)?.cs ?? 1) === t.head.length, merged: !!mergeAt(t, r, c) }" @pointerdown="cellDown($event, r, c)" @pointerenter="cellEnter(r, c)" @contextmenu="onCellMenu($event, r, c)">
              <template v-if="c === firstShown(r)">
                <button class="bt-rh tw:absolute tw:top-7 tw:-left-19 tw:inline-flex tw:items-center tw:justify-center tw:w-16 tw:h-20 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:opacity-0 tw:group-hover/g34:not-group-focus-within/g34:opacity-100 tw:group-focus-within/g34:opacity-100 tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Строка: вставить, удалить" @mousedown.prevent @click="openMenu('row', r, $event)"><Icon name="grip" :size="12" /></button>
                <button class="bt-plus row tw:absolute tw:z-3 tw:inline-flex tw:items-center tw:justify-center tw:w-18 tw:h-18 tw:p-0 tw:border tw:border-border-2 tw:rounded-[50%] tw:bg-pop tw:text-text-2 tw:opacity-0 tw:[transition:opacity_0.1s] tw:-left-21 tw:-bottom-9 tw:group-hover/g34:opacity-100 tw:hover:border-accent tw:hover:bg-accent tw:hover:text-white" title="Вставить строку здесь" @mousedown.prevent @click="(addRow(r + 1), focusCell(r + 1, 0))"><Icon name="plus" :size="11" /></button>
              </template>
              <textarea class="tw:group-[.sel]/g32:select-none tw:block tw:w-full tw:min-h-0 tw:pt-7 tw:pr-26 tw:pb-7 tw:pl-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:font-[inherit] tw:[&&]:leading-[1.45] tw:resize-none tw:field-sizing-content tw:outline-none tw:focus:[box-shadow:inset_0_0_0_2px_rgb(var(--accent-rgb)/0.7)]" v-if="isEdit(r, c)" :data-rc="`${r}:${c}`" :value="cell" rows="1" spellcheck="false" :style="{ textAlign: mergeAt(t, r, c) ? 'center' : (t.align[c] ?? 'left') }" @input="setCell(r, c, ($event.target as HTMLTextAreaElement).value)" @keydown="onKey($event, r, c)" @focus="onFocusCell(r, c)" @blur="leaveCell(r, c)"></textarea>
              <div v-else class="cv tw:min-h-[calc(1.45em+14px)] tw:max-w-420 tw:pt-7 tw:pr-26 tw:pb-7 tw:pl-10 tw:overflow-hidden tw:leading-[1.45] tw:text-ellipsis tw:whitespace-nowrap tw:cursor-text tw:[&.wrap]:whitespace-pre-wrap tw:[&.wrap]:[word-break:break-word] tw:group-[.fixed-cols]/g33:max-w-none" :class="{ wrap: t.wrap }" :style="{ textAlign: mergeAt(t, r, c) ? 'center' : (t.align[c] ?? 'left') }" :title="!t.wrap && cell.length > 24 ? cell.slice(0, 2000) : undefined">{{ cell || ' ' }}</div>
            </td>
            </template>
          </tr>
        </tbody>
        <tfoot v-if="sums.length">
          <tr class="tw:group/g35">
            <td class="tw:min-w-90 tw:max-w-420 tw:border-t tw:border-t-border-2 tw:border-b-0 tw:bg-panel-2 tw:group-[.fixed-cols]/g33:min-w-0 tw:group-[.fixed-cols]/g33:max-w-none tw:p-0 tw:border-r tw:border-r-border tw:align-top tw:last:border-r-0" v-for="(_, c) in t.head" :key="c" :style="{ textAlign: t.align[c] ?? 'left' }">
              <span v-if="sumOf(c)" class="bt-sum tw:block tw:py-5 tw:px-10 tw:text-accent-fg tw:font-data tw:text-[0.95em] tw:tabular-nums tw:font-semibold" :title="sumTitle(c)">Σ {{ fmtSum(sumOf(c)!.sum) }}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div v-if="selCells > 1 || curMerge" class="bt-bar tw:flex tw:items-center tw:gap-8 tw:mt-6" @mousedown.prevent>
      <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px]" v-if="selCells > 1" @click="doMerge"><Icon name="layers" :size="13" />Объединить ячейки ({{ selCells }})</button>
      <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px]" v-else-if="curMerge" @click="doUnmerge"><Icon name="layers" :size="13" />Разъединить</button>
      <span v-if="selCells > 1" class="hint tw:text-muted tw:text-[11.5px]">Esc — отменить выбор</span>
    </div>
    <ContextMenu v-if="cellMenu" :x="cellMenu.x" :y="cellMenu.y" :items="cellItems" @close="cellMenu = undefined" />
    <TableMenu ref="menuRef" :table="t" @add-col="addCol" @del-col="delCol" @add-row="addRow" @del-row="delRow" @align="setAlign" @sort="sortBy" @sum="toggleSum" />
  </div>
</template>

<style scoped src="./BlockTable.css"></style>
