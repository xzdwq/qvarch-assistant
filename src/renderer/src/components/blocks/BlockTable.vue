<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { parseTable, tableMd, type Align, type TableModel } from '@shared/noteBlocks'
import Icon from '../Icon.vue'

/**
 * A table of the notebook, edited as a table: cells typed into right away (Tab — the next one, Enter — the
 * one below, Shift+Enter — a new line inside the cell); a «+» on the border between two columns / two rows puts
 * one there; a column's right edge is dragged for its width (double click — back to «by the content»); a
 * column's ▾ — insert, align, sort, delete; a row's handle — insert, delete. The file keeps a GFM table, its
 * columns lined up (the widths — in a comment over it).
 */
const props = defineProps<{ src: string; autofocus?: boolean }>()
const emit = defineEmits<{ change: [src: string]; exit: [dir: 1 | -1] }>()
const t = ref<TableModel>(parseTable(props.src))
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    t.value = parseTable(s)
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(timer)
  const go = () => {
    const md = tableMd(t.value)
    if (md === mine) return
    mine = md
    emit('change', md)
  }
  if (now) go()
  else timer = setTimeout(go, 250)
}
const cols = () => t.value.head.length
// ---------- cells and moving between them ----------
const root = ref<HTMLElement>()
function cellEl(r: number, c: number): HTMLTextAreaElement | null {
  return root.value?.querySelector(`[data-rc="${r}:${c}"]`) ?? null
}
async function focusCell(r: number, c: number, end = true): Promise<void> {
  await nextTick()
  const el = cellEl(r, c)
  if (!el) return
  el.focus()
  const p = end ? el.value.length : 0
  el.setSelectionRange(p, p)
}
function onKey(e: KeyboardEvent, r: number, c: number): void {
  const el = e.target as HTMLTextAreaElement
  const rows = t.value.rows.length
  if (e.key === 'Tab') {
    e.preventDefault()
    let nr = r
    let nc = c + (e.shiftKey ? -1 : 1)
    if (nc >= cols()) ((nc = 0), nr++)
    if (nc < 0) ((nc = cols() - 1), nr--)
    if (nr > rows) addRow(rows)
    if (nr < -1) return
    void focusCell(nr, nc)
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (r === rows - 1 || (r === -1 && !rows)) addRow(rows)
    void focusCell(r + 1, c)
  } else if (e.key === 'ArrowUp' && !el.value.slice(0, el.selectionStart).includes('\n')) {
    if (r === -1) {
      e.preventDefault()
      emit('exit', -1)
    } else {
      e.preventDefault()
      void focusCell(r - 1, c)
    }
  } else if (e.key === 'ArrowDown' && !el.value.slice(el.selectionEnd).includes('\n')) {
    e.preventDefault()
    if (r === rows - 1) emit('exit', 1)
    else void focusCell(r + 1, c)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('exit', 1)
  }
}
const setCell = (r: number, c: number, v: string) => {
  if (r === -1) t.value.head[c] = v
  else t.value.rows[r][c] = v
  save()
}
// ---------- rows and columns ----------
function addRow(at: number): void {
  t.value.rows.splice(at, 0, Array(cols()).fill(''))
  save(true)
}
function delRow(at: number): void {
  if (!t.value.rows.length) return
  t.value.rows.splice(at, 1)
  save(true)
}
function addCol(at: number): void {
  t.value.head.splice(at, 0, `Столбец ${cols() + 1}`)
  t.value.align.splice(at, 0, undefined)
  t.value.widths?.splice(at, 0, 0)
  for (const r of t.value.rows) r.splice(at, 0, '')
  save(true)
}
function delCol(at: number): void {
  if (cols() <= 1) return
  t.value.head.splice(at, 1)
  t.value.align.splice(at, 1)
  t.value.widths?.splice(at, 1)
  for (const r of t.value.rows) r.splice(at, 1)
  save(true)
}
function setAlign(c: number, a: Align): void {
  t.value.align[c] = a
  save(true)
}
function sortBy(c: number, dir: 1 | -1): void {
  const n = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'))
  t.value.rows.sort((a, b) => {
    const x = n(a[c])
    const y = n(b[c])
    return dir * (Number.isFinite(x) && Number.isFinite(y) && a[c].trim() && b[c].trim() ? x - y : a[c].localeCompare(b[c], 'ru', { numeric: true }))
  })
  save(true)
}
// ---------- the menus (a column's ▾, a row's handle) ----------
const menu = ref<{ kind: 'col' | 'row'; i: number; x: number; y: number }>()
function openMenu(kind: 'col' | 'row', i: number, e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menu.value = { kind, i, x: Math.min(r.left, window.innerWidth - 230), y: r.bottom + 4 }
}
function onDocDown(e: PointerEvent): void {
  if (!(e.target as HTMLElement).closest('.bt-menu')) menu.value = undefined
}
watch(menu, (m) => (m ? window.addEventListener('pointerdown', onDocDown, true) : window.removeEventListener('pointerdown', onDocDown, true)))
function act(fn: () => void): void {
  fn()
  menu.value = undefined
}
// ---------- a column's width ----------
const tableEl = ref<HTMLTableElement>()
const fixed = () => !!t.value.widths?.some((w) => w > 0)
function dragWidth(c: number, e: PointerEvent): void {
  e.preventDefault()
  const ths = [...(tableEl.value?.querySelectorAll('thead th') ?? [])] as HTMLElement[]
  // the first drag fixes every column at its width now (the others must not jump)
  if (!fixed()) t.value.widths = ths.map((th) => Math.round(th.getBoundingClientRect().width))
  const w0 = t.value.widths![c]
  const x0 = e.clientX
  const move = (ev: PointerEvent) => {
    t.value.widths![c] = Math.max(60, Math.min(900, Math.round(w0 + ev.clientX - x0)))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    save(true)
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function autoWidth(c: number): void {
  if (!t.value.widths) return
  t.value.widths[c] = 0
  if (!t.value.widths.some((w) => w > 0)) t.value.widths = undefined
  else {
    // a column «by the content» in a fixed table: as wide as it is now
    const th = tableEl.value?.querySelectorAll('thead th')[c] as HTMLElement | undefined
    t.value.widths[c] = th ? Math.round(th.getBoundingClientRect().width) : 160
  }
  save(true)
}
const colStyle = (c: number) => (fixed() ? { width: `${t.value.widths![c] || 160}px` } : {})
onMounted(() => props.autofocus && void focusCell(-1, 0))
defineExpose({ focusFirst: () => focusCell(-1, 0), focusLast: () => focusCell(t.value.rows.length - 1, 0) })
</script>

<template>
  <div ref="root" class="bt">
    <div class="bt-scroll">
      <table ref="tableEl" :class="{ fixed: fixed() }">
        <colgroup><col v-for="(_, c) in t.head" :key="c" :style="colStyle(c)" /></colgroup>
        <thead>
          <tr>
            <th v-for="(h, c) in t.head" :key="c" :style="{ textAlign: t.align[c] ?? 'left' }">
              <button class="bt-plus col" title="Вставить столбец здесь" @mousedown.prevent @click="(addCol(c + 1), focusCell(-1, c + 1))"><Icon name="plus" :size="11" /></button>
              <span class="bt-rz" title="Потяните — ширина столбца · двойной клик — по содержимому" @pointerdown="dragWidth(c, $event)" @dblclick="autoWidth(c)"></span>
              <textarea :data-rc="`-1:${c}`" :value="h" rows="1" spellcheck="false" :style="{ textAlign: t.align[c] ?? 'left' }" @input="setCell(-1, c, ($event.target as HTMLTextAreaElement).value)" @keydown="onKey($event, -1, c)" @blur="save(true)"></textarea>
              <button class="bt-cm" title="Столбец: вставить, выровнять, сортировать, удалить" @mousedown.prevent @click="openMenu('col', c, $event)"><Icon name="chevronDown" :size="12" /></button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in t.rows" :key="r">
            <td v-for="(cell, c) in row" :key="c">
              <template v-if="c === 0">
                <button class="bt-rh" title="Строка: вставить, удалить" @mousedown.prevent @click="openMenu('row', r, $event)"><Icon name="grip" :size="12" /></button>
                <button class="bt-plus row" title="Вставить строку здесь" @mousedown.prevent @click="(addRow(r + 1), focusCell(r + 1, 0))"><Icon name="plus" :size="11" /></button>
              </template>
              <textarea :data-rc="`${r}:${c}`" :value="cell" rows="1" spellcheck="false" :style="{ textAlign: t.align[c] ?? 'left' }" @input="setCell(r, c, ($event.target as HTMLTextAreaElement).value)" @keydown="onKey($event, r, c)" @blur="save(true)"></textarea>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <Teleport to="body">
      <div v-if="menu" class="bt-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
        <template v-if="menu.kind === 'col'">
          <button @click="act(() => addCol(menu!.i))"><Icon name="chevronLeft" :size="13" />Вставить слева</button>
          <button @click="act(() => addCol(menu!.i + 1))"><Icon name="chevronRight" :size="13" />Вставить справа</button>
          <hr />
          <div class="bt-al">
            <span>Выравнивание</span>
            <button :class="{ on: !t.align[menu.i] || t.align[menu.i] === 'left' }" title="По левому краю" @click="act(() => setAlign(menu!.i, undefined))">⇤</button>
            <button :class="{ on: t.align[menu.i] === 'center' }" title="По центру" @click="act(() => setAlign(menu!.i, 'center'))">↔</button>
            <button :class="{ on: t.align[menu.i] === 'right' }" title="По правому краю" @click="act(() => setAlign(menu!.i, 'right'))">⇥</button>
          </div>
          <button @click="act(() => sortBy(menu!.i, 1))"><Icon name="sort" :size="13" />Сортировать по возрастанию</button>
          <button @click="act(() => sortBy(menu!.i, -1))"><Icon name="sort" :size="13" />Сортировать по убыванию</button>
          <hr />
          <button class="danger" :disabled="t.head.length <= 1" @click="act(() => delCol(menu!.i))"><Icon name="trash" :size="13" />Удалить столбец</button>
        </template>
        <template v-else>
          <button @click="act(() => addRow(menu!.i))"><Icon name="chevronDown" :size="13" style="transform: rotate(180deg)" />Вставить выше</button>
          <button @click="act(() => addRow(menu!.i + 1))"><Icon name="chevronDown" :size="13" />Вставить ниже</button>
          <hr />
          <button class="danger" @click="act(() => delRow(menu!.i))"><Icon name="trash" :size="13" />Удалить строку</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.bt {
  position: relative;
}
/* room around the table for its «+» and handles (they stand on its borders) */
.bt-scroll {
  position: relative;
  max-width: calc(100% + 24px);
  margin: -24px -12px -10px -24px;
  padding: 24px 12px 10px 24px;
  /* (the room over the text around is not the table's: clicks there go to the text) */
  pointer-events: none;
  overflow-x: auto;
}
table {
  pointer-events: auto;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--border-2);
  border-radius: 8px;
  font-size: 0.92em;
}
table.fixed {
  table-layout: fixed;
  width: max-content;
}
thead th:first-child {
  border-top-left-radius: 7px;
}
thead th:last-child {
  border-top-right-radius: 7px;
}
th,
td {
  position: relative;
  min-width: 90px;
  max-width: 420px;
}
table.fixed th,
table.fixed td {
  min-width: 0;
  max-width: none;
}
th,
td {
  padding: 0;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th:last-child,
td:last-child {
  border-right: 0;
}
tbody tr:last-child td {
  border-bottom: 0;
}
th {
  background: var(--panel-2);
}
textarea {
  display: block;
  width: 100%;
  min-height: 0;
  padding: 7px 26px 7px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  line-height: 1.45;
  resize: none;
  field-sizing: content;
  outline: none;
}
th textarea {
  color: var(--text-hi);
  font-weight: 600;
}
textarea:focus {
  box-shadow: inset 0 0 0 2px rgb(var(--accent-rgb) / 0.7);
}
.bt-cm {
  position: absolute;
  top: 6px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: var(--panel-3);
  color: var(--text-2);
  opacity: 0;
}
th:hover .bt-cm,
th:focus-within .bt-cm {
  opacity: 1;
}
.bt-rh {
  position: absolute;
  top: 7px;
  left: -19px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  opacity: 0;
}
tr:hover .bt-rh,
tr:focus-within .bt-rh {
  opacity: 1;
}
.bt-rh:hover,
.bt-cm:hover {
  background: var(--hover);
  color: var(--text);
}
/* the «+» on a border: between this column and the next / this row and the next */
.bt-plus {
  position: absolute;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: 50%;
  background: var(--pop);
  color: var(--text-2);
  opacity: 0;
  transition: opacity 0.1s;
}
.bt-plus.col {
  top: -21px;
  right: -9px;
}
.bt-plus.row {
  left: -21px;
  bottom: -9px;
}
th:hover > .bt-plus.col,
tr:hover .bt-plus.row {
  opacity: 1;
}
.bt-plus:hover {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.bt-rz {
  position: absolute;
  z-index: 2;
  top: 0;
  right: -4px;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
}
.bt-rz:hover,
.bt-rz:active {
  background: linear-gradient(90deg, transparent 3px, rgb(var(--accent-rgb) / 0.8) 3px 5px, transparent 5px);
}
.bt-menu {
  position: fixed;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  width: 220px;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.bt-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.bt-menu button:hover:not(:disabled) {
  background: var(--hover);
}
.bt-menu button.danger {
  color: var(--down-fg);
}
.bt-menu button:disabled {
  opacity: 0.4;
}
.bt-menu hr {
  margin: 4px 0;
  border: 0;
  border-top: 1px solid var(--border);
}
.bt-al {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  color: var(--text-2);
  font-size: 12px;
}
.bt-al span {
  flex: 1;
}
.bt-al button {
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
}
.bt-al button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
</style>
