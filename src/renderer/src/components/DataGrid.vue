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
  <p v-if="g.exported.value" class="muted saved">{{ g.exported.value }}</p>
  <div v-if="g.data.value" :ref="setBox" class="dg" tabindex="0" :style="{ maxHeight: `${maxHeight ?? 420}px` }" @keydown="g.onKey">
    <table :style="{ width: `${width}px` }">
      <colgroup>
        <col :style="{ width: `${NUM_W}px` }" />
        <col v-for="(w, i) in g.widths.value" :key="i" :style="{ width: `${w}px` }" />
      </colgroup>
      <thead>
        <tr>
          <th class="num" title="Выделить всё (Ctrl+A) · Ctrl+C — копировать выделенное" @click="g.pickAll">#</th>
          <th v-for="(c, i) in g.data.value.columns" :key="i" :class="{ picked: g.sel.value?.head && g.inSel(0, i) }" :title="`${c.name}${c.type ? ` · ${c.type}` : ''} — клик: выделить колонку (Shift — несколько)`" @click="g.pickCol($event, i)">
            <span class="cn">{{ c.name }}</span><span v-if="c.type" class="ct">{{ c.type }}</span>
            <i class="rz" title="Перетащите — ширина колонки; двойной клик — по содержимому" @pointerdown="g.resize($event, i)" @dblclick="g.fit(i)"></i>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in g.shownRows.value" :key="i">
          <td class="num" title="Выделить строку (Shift — несколько)" @pointerdown="g.pickRow($event, i)">{{ i + 1 }}</td>
          <td v-for="(v, j) in r" :key="j" :class="{ nul: v === null, sel: g.inSel(i, j), open: g.unfolded.value.has(`${i}:${j}`) }" :title="!g.unfolded.value.has(`${i}:${j}`) && cellText(v).length > 60 ? cellText(v).slice(0, 2000) : undefined" @pointerdown="g.cellDown($event, i, j)" @pointerenter="g.cellEnter(i, j)" @contextmenu="g.onCellMenu($event, i, j)">
            <template v-if="g.jsonCells.value[i]?.[j]">
              <button class="jt" :title="g.unfolded.value.has(`${i}:${j}`) ? 'Свернуть JSON' : 'Развернуть JSON'" @pointerdown.stop @click.stop="g.toggleJson(i, j)"><Icon name="chevronRight" :size="11" :style="g.unfolded.value.has(`${i}:${j}`) ? 'transform: rotate(90deg)' : ''" /></button>
              <pre v-if="g.unfolded.value.has(`${i}:${j}`)" class="jv" @pointerdown.stop>{{ g.prettyJson(v) }}</pre>
              <template v-else>{{ cellText(v) }}</template>
            </template>
            <template v-else>{{ v === null ? 'NULL' : cellText(v) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="g.data.value.rows.length > g.limit" class="muted more">Показаны первые {{ g.limit }} из {{ g.data.value.rows.length }} — все строки в экспорте, в выделении колонок и в переменной.</p>
  </div>
  <ContextMenu v-if="g.cellMenu.value" :x="g.cellMenu.value.x" :y="g.cellMenu.value.y" :items="g.cellItems.value" @close="g.cellMenu.value = undefined" />
</template>

<style scoped>
.muted {
  color: var(--muted);
}
.saved {
  margin: 4px 10px;
  font-size: 12px;
  word-break: break-all;
}
.more {
  margin: 6px 8px;
  font-size: 12px;
}
/* the rows scroll inside (both ways): a wide table never widens the note — the box's width is its parent's */
.dg {
  overflow: auto;
  contain: inline-size;
}
.dg:focus {
  outline: none;
}
/* as the notebook's own table: lines right and under each cell (separate borders — a sticky head keeps all of them) */
.dg table {
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--font-data);
  font-size: 12px;
}
.dg th,
.dg td {
  padding: 5px 10px;
  overflow: hidden;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
}
.dg tbody tr:last-child td {
  border-bottom: 0;
}
.dg tbody tr:hover td {
  background: var(--hover);
}
.dg th {
  position: sticky;
  z-index: 1;
  top: 0;
  padding-right: 12px;
  background: var(--panel-2);
  color: var(--text-hi);
  font-weight: 600;
  vertical-align: top;
  cursor: pointer;
}
.dg th.picked {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.dg th .cn,
.dg th .ct {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dg th .ct {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 400;
}
/* (a tall unfolded cell: the row's other cells at its top, not in its middle) */
.dg td {
  vertical-align: top;
}
.dg td.nul {
  color: var(--muted);
  font-style: italic;
}
.dg td.sel {
  background: rgb(var(--accent-rgb) / 0.18);
}
.dg tbody tr:hover td.sel {
  background: rgb(var(--accent-rgb) / 0.26);
}
/* a JSON cell: its ▸ before the value; unfolded — the JSON laid out inside the cell (it grows, scrolls inside) */
.jt {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin: 0 4px 0 -4px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--accent-fg);
  vertical-align: -3px;
}
.jt:hover {
  background: var(--hover);
}
.dg td.open {
  position: relative;
  white-space: normal;
}
/* unfolded: the toggle at the JSON's first line */
.dg td.open .jt {
  position: absolute;
  top: 5px;
  left: 6px;
  margin: 0;
}
.dg td.open .jv {
  margin: 0 0 0 14px;
}
.jv {
  max-height: 320px;
  margin: 4px 0 0;
  overflow: auto;
  color: var(--text);
  font-size: 11.5px;
  line-height: 1.45;
  white-space: pre;
  /* (its text chosen and copied as any text) */
  user-select: text;
  cursor: text;
}
/* the rows' numbers: a click — the row */
.dg .num {
  position: sticky;
  z-index: 1;
  left: 0;
  padding: 5px 6px;
  background: var(--panel-2);
  color: var(--muted);
  text-align: right;
  cursor: pointer;
}
.dg thead .num {
  z-index: 2;
}
/* (over the cells scrolled under it: never see-through) */
.dg tbody tr:hover td.num {
  background: var(--panel-2);
  color: var(--text-2);
}
/* the column's border: dragged — its width */
.rz {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  z-index: 2;
  width: 7px;
  cursor: col-resize;
}
.rz:hover {
  background: rgb(var(--accent-rgb) / 0.35);
}
</style>
