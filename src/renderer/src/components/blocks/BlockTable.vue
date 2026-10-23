<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { columnSum, coveredBy, deleteColAt, deleteRowAt, fmtSum, insertColAt, insertRowAt, mergeAt, mergeCells, parseTable, tableHash, tableMd, textHash, unmergeCell, valueTable, type Align, type TableModel } from '@shared/noteBlocks'
import { resolvePath, summary } from '@shared/runbook'
import { envAt, noteRun } from '../../lib/runbook'
import { doc } from '../../lib/notebook'
import MenuButton from '../MenuButton.vue'
import CodeArea from '../CodeArea.vue'
import SuggestInput from '../SuggestInput.vue'
import { beside, useFollow } from '../../lib/floating'
import Icon from '../Icon.vue'
import ContextMenu from '../ContextMenu.vue'
import type { MenuItem } from '../MenuButton.vue'

/**
 * A table of the notebook, edited as a table: cells typed into right away (Tab — the next one, Enter — the
 * one below, Shift+Enter — a new line inside the cell); a «+» on the border between two columns / two rows puts
 * one there; a column's right edge is dragged for its width (double click — back to «by the content»); a
 * column's ▾ — insert, align, sort, delete; a row's handle — insert, delete. The file keeps a GFM table, its
 * columns lined up (the widths, the sums, the merged cells — in a comment over it). Cells dragged over (or
 * Shift+click) — merged by the button under the table; a column's ▾ — its sum under it.
 * «Из переменной»: filled from a value of the note (a query's rows, an answer's list, code's result — objects' keys
 * become the columns); edited as any table; while not edited — filled again when the value changes; «Отделить» —
 * a table of its own. Seen as JSON too; copied / saved as Excel or CSV.
 */
const props = defineProps<{ src: string; autofocus?: boolean; path?: string; line?: number }>()
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
/**
 * The cell being typed in: only it is a field — the others are their text (one line cut with «…», or wrapped): a
 * table of hundreds of cells stays light, scrolls smoothly.
 */
const edit = ref<{ r: number; c: number }>()
const isEdit = (r: number, c: number) => edit.value?.r === r && edit.value.c === c
function leaveCell(r: number, c: number): void {
  save(true)
  if (isEdit(r, c)) edit.value = undefined
}
async function focusCell(r: number, c: number, end = true): Promise<void> {
  edit.value = { r, c }
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
  insertRowAt(t.value, at)
  save(true)
}
function delRow(at: number): void {
  if (!t.value.rows.length) return
  deleteRowAt(t.value, at)
  save(true)
}
function addCol(at: number): void {
  t.value.head.splice(at, 0, `Столбец ${cols() + 1}`)
  t.value.align.splice(at, 0, undefined)
  t.value.widths?.splice(at, 0, 0)
  insertColAt(t.value, at)
  save(true)
}
function delCol(at: number): void {
  if (cols() <= 1) return
  t.value.head.splice(at, 1)
  t.value.align.splice(at, 1)
  t.value.widths?.splice(at, 1)
  deleteColAt(t.value, at)
  save(true)
}
// ---------- a column's sum ----------
function toggleSum(c: number): void {
  const s = new Set(t.value.sums ?? [])
  if (s.has(c)) s.delete(c)
  else s.add(c)
  t.value.sums = s.size ? [...s].sort((a, b) => a - b) : undefined
  save(true)
}
const sums = computed(() => (t.value.sums ?? []).map((c) => [c, columnSum(t.value, c)] as const))
const sumOf = (c: number) => sums.value.find(([x]) => x === c)?.[1]
const sumTitle = (c: number) => {
  const x = sumOf(c)
  return x ? `Сумма чисел: ${x.count}${x.skipped ? ` · пропущено нечисловых: ${x.skipped}` : ''}` : ''
}

// ---------- choosing cells (a drag over them, or Shift+click) and merging them ----------
type Sel = { r0: number; c0: number; r1: number; c1: number }
const sel = ref<Sel>()
let downAt: { r: number; c: number } | undefined
/** The cell typed in last — Shift+click chooses from it. */
let lastCell: { r: number; c: number } | undefined
const inSel = (r: number, c: number) => {
  const x = sel.value
  return !!x && r >= Math.min(x.r0, x.r1) && r <= Math.max(x.r0, x.r1) && c >= Math.min(x.c0, x.c1) && c <= Math.max(x.c0, x.c1)
}
function cellDown(e: PointerEvent, r: number, c: number): void {
  if (e.button !== 0) return
  if (e.shiftKey && lastCell && lastCell.r >= 0) {
    e.preventDefault()
    sel.value = { r0: lastCell.r, c0: lastCell.c, r1: r, c1: c }
    ;(document.activeElement as HTMLElement | null)?.blur()
    return
  }
  sel.value = undefined
  downAt = { r, c }
  window.addEventListener('pointerup', cellUp, { once: true })
}
function cellEnter(r: number, c: number): void {
  if (!downAt || (downAt.r === r && downAt.c === c && !sel.value)) return
  sel.value = { r0: downAt.r, c0: downAt.c, r1: r, c1: c }
  ;(document.activeElement as HTMLElement | null)?.blur()
  getSelection()?.removeAllRanges()
}
function cellUp(): void {
  const at = downAt
  downAt = undefined
  // a click (no cells dragged over): the cell is typed in — unless it already is (the caret goes where clicked)
  if (at && !sel.value && !isEdit(at.r, at.c)) void focusCell(at.r, at.c)
}
const selCells = computed(() => (sel.value ? (Math.abs(sel.value.r1 - sel.value.r0) + 1) * (Math.abs(sel.value.c1 - sel.value.c0) + 1) : 0))
function doMerge(): void {
  const x = sel.value
  if (!x) return
  mergeCells(t.value, x.r0, x.c0, x.r1, x.c1)
  sel.value = undefined
  save(true)
  void focusCell(Math.min(x.r0, x.r1), Math.min(x.c0, x.c1))
}
/** The merged cell being typed in (its button «Разъединить»). */
const curMerge = ref<{ r: number; c: number }>()
function doUnmerge(): void {
  if (!curMerge.value) return
  unmergeCell(t.value, curMerge.value.r, curMerge.value.c)
  curMerge.value = undefined
  save(true)
}
function onFocusCell(r: number, c: number): void {
  lastCell = { r, c }
  curMerge.value = r >= 0 && mergeAt(t.value, r, c) ? { r, c } : undefined
}
/** The chosen cells as Excel takes them: tab between the columns, a new line between the rows. */
function selText(): string {
  const x = sel.value!
  const rows: string[] = []
  for (let r = Math.min(x.r0, x.r1); r <= Math.max(x.r0, x.r1); r++) {
    const cells: string[] = []
    for (let c = Math.min(x.c0, x.c1); c <= Math.max(x.c0, x.c1); c++) {
      const v = r < 0 ? t.value.head[c] : (t.value.rows[r]?.[c] ?? '')
      // (a cell's own tabs / line breaks would cut it apart — quoted as Excel quotes them)
      cells.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    }
    rows.push(cells.join('\t'))
  }
  return rows.join('\n')
}
/** The chosen cells emptied (merged ones keep their merge). */
function clearSel(): void {
  const x = sel.value
  if (!x) return
  for (let r = Math.min(x.r0, x.r1); r <= Math.max(x.r0, x.r1); r++)
    for (let c = Math.min(x.c0, x.c1); c <= Math.max(x.c0, x.c1); c++) {
      if (r < 0) t.value.head[c] = ''
      else if (t.value.rows[r]) t.value.rows[r][c] = ''
    }
  save(true)
}
/** A right click over chosen cells: their menu (with no cells chosen — the text's own menu in the cell). */
const cellMenu = ref<{ x: number; y: number }>()
function onCellMenu(e: MouseEvent, r: number, c: number): void {
  if (!sel.value || selCells.value < 2) return
  if (!inSel(r, c)) sel.value = { r0: r, c0: c, r1: r, c1: c }
  e.preventDefault()
  cellMenu.value = { x: e.clientX, y: e.clientY }
}
const cellItems = computed<MenuItem[]>(() => [
  { label: `Копировать (${selCells.value})`, icon: 'copy', title: 'Ctrl+C — в Excel вставляется по столбцам', run: () => navigator.clipboard.writeText(selText()) },
  { label: 'Объединить', icon: 'layers', disabled: selCells.value < 2, run: doMerge },
  { label: 'Очистить', icon: 'trash', title: 'Значения выбранных ячеек — пустые', run: clearSel },
])
const onEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && sel.value) sel.value = undefined
  // Ctrl+C over chosen cells: their values copied
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && sel.value && !(document.activeElement instanceof HTMLTextAreaElement)) {
    e.preventDefault()
    void navigator.clipboard.writeText(selText())
  }
}
const onAway = (e: PointerEvent) => {
  // (the chosen cells' own menu is not «elsewhere»)
  if (!root.value?.contains(e.target as Node) && !(e.target as Element).closest?.('.cx-menu')) {
    sel.value = undefined
    curMerge.value = undefined
  }
}
window.addEventListener('keydown', onEsc)
window.addEventListener('pointerdown', onAway, true)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEsc)
  window.removeEventListener('pointerdown', onAway, true)
})
const span = (r: number, c: number) => {
  const m = mergeAt(t.value, r, c)
  return m ? { rowspan: m.rs, colspan: m.cs } : {}
}
function setAlign(c: number, a: Align): void {
  t.value.align[c] = a
  save(true)
}
function sortBy(c: number, dir: 1 | -1): void {
  // merged cells hold rows together — no sorting then
  if (t.value.merges?.length) return
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
const menuEl = ref<HTMLElement>()
/** The button the menu opened from — the menu stays by it (the page scrolled), closes when it is out of sight. */
let menuAnchor: HTMLElement | undefined
const MENU_W = 250
const menuAt = (r: DOMRect) => beside(r, MENU_W, menuEl.value?.offsetHeight ?? 330)
function openMenu(kind: 'col' | 'row', i: number, e: MouseEvent): void {
  menuAnchor = e.currentTarget as HTMLElement
  menu.value = { kind, i, ...menuAt(menuAnchor.getBoundingClientRect()) }
}
useFollow(
  menu,
  () => menuAnchor,
  (r) => menu.value && (menu.value = { ...menu.value, ...menuAt(r) }),
  () => (menu.value = undefined),
)
function onDocDown(e: PointerEvent): void {
  if (!(e.target as HTMLElement).closest('.bt-menu')) menu.value = undefined
}
watch(menu, (m) => (m ? window.addEventListener('pointerdown', onDocDown, true) : window.removeEventListener('pointerdown', onDocDown, true)))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onDocDown, true))
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
/** A row's first cell drawn (the others before it are under a merge from above) — the row's handles are there. */
const firstShown = (r: number) => {
  for (let c = 0; c < cols(); c++) if (!coveredBy(t.value, r, c)) return c
  return -1
}
const colStyle = (c: number) => (fixed() ? { width: `${t.value.widths![c] || 160}px` } : {})
// ---------- «Из переменной» ----------
/** The value the table is filled from (the note's — in a loop, the pass shown). */
const source = computed(() => {
  const from = t.value.from
  if (!from || !props.path) return undefined
  // (follows the note's values: a block run again changes its time; another pass picked)
  const n = noteRun(props.path)
  for (const k in n.ctx) void n.ctx[k].at
  for (const k in n.loops) void n.loops[k].sel
  return resolvePath(envAt(props.path, props.line ?? 0, doc(props.path).text).values(), from)
})
const sourceKey = computed(() => (source.value?.ok ? JSON.stringify(source.value.value) ?? '' : undefined))
/** Edited since it was filled (a refill would lose the edits — asked first). */
const edited = computed(() => !!t.value.from && t.value.filled !== tableHash(t.value))
const stale = ref(false)
function fill(): void {
  const v = source.value
  if (!v?.ok) return
  const vt = valueTable(v.value)
  const same = vt.head.length === t.value.head.length
  t.value.head = vt.head
  t.value.rows = vt.rows.length ? vt.rows : [vt.head.map(() => '')]
  t.value.align = same ? t.value.align : vt.head.map(() => undefined)
  if (!same) t.value.widths = undefined
  t.value.sums = t.value.sums?.filter((c) => c < vt.head.length)
  if (!t.value.sums?.length) t.value.sums = undefined
  t.value.merges = undefined
  t.value.filled = tableHash(t.value)
  t.value.srcHash = sourceKey.value === undefined ? undefined : textHash(sourceKey.value)
  stale.value = false
  save(true)
}
/**
 * The value changed (now, or while the table was off screen — its last value's hash kept with it): never filled yet,
 * or not edited since — filled now; edited — the person decides («Обновить»).
 */
function follow(): void {
  const k = sourceKey.value
  if (k === undefined || (t.value.filled && t.value.srcHash === textHash(k))) return
  if (!t.value.filled || !edited.value) fill()
  else stale.value = true
}
watch(sourceKey, follow)
/** The type: an ordinary table, or one filled from a value (its path asked for). */
const asking = ref(false)
const fromDraft = ref(t.value.from ?? '')
function setFrom(path: string): void {
  const v = path.trim()
  asking.value = false
  if (!v) return
  t.value.from = v
  t.value.filled = undefined
  save(true)
  fill()
}
/** Cut off from its value: a table of its own, the data kept. */
function detach(): void {
  t.value.from = undefined
  t.value.filled = undefined
  stale.value = false
  asking.value = false
  save(true)
}
/** The note's values to choose from (lists first — what a table most likely shows). */
const varNames = computed(() => {
  if (!props.path) return []
  const ctx = noteRun(props.path).ctx
  return Object.keys(ctx).sort((a, b) => Number(Array.isArray(ctx[b].value)) - Number(Array.isArray(ctx[a].value)) || ctx[b].at - ctx[a].at)
})
// ---------- as JSON; copied / saved ----------
const asJson = ref(false)
function setWrap(on: boolean): void {
  t.value.wrap = on || undefined
  save(true)
}
const objects = computed(() => t.value.rows.map((r) => Object.fromEntries(t.value.head.map((h, i) => [h || `Столбец ${i + 1}`, r[i] ?? '']))))
const exported = ref('')
async function exportAs(format: 'xlsx' | 'csv'): Promise<void> {
  exported.value = ''
  const file = await window.qa.sql('exportRows', { format, name: t.value.from ?? 'Таблица', columns: t.value.head.map((name) => ({ name })), rows: t.value.rows.map((r) => [...r]) })
  if (file) exported.value = `Сохранено: ${file}`
}
const allText = () => [t.value.head, ...t.value.rows].map((r) => r.map((v) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t')).join('\n')
const exportItems = computed<MenuItem[]>(() => [
  { label: 'Копировать', icon: 'copy', title: 'В буфер — вставляется в Excel по столбцам', run: () => navigator.clipboard.writeText(allText()) },
  { label: 'Сохранить в Excel (.xlsx)', icon: 'table', run: () => exportAs('xlsx') },
  { label: 'Сохранить в CSV (UTF-8)', icon: 'list', run: () => exportAs('csv') },
])
onMounted(() => {
  if (props.autofocus) void focusCell(-1, 0)
  // a table just made «from a value» — filled at once; one whose value changed while it was off screen — followed
  if (t.value.from) follow()
})
defineExpose({ focusFirst: () => focusCell(-1, 0), focusLast: () => focusCell(t.value.rows.length - 1, 0) })
</script>

<template>
  <div ref="root" class="bt">
    <div class="bt-tools" @mousedown.prevent>
      <span class="seg" title="Тип таблицы">
        <button :class="{ on: !t.from && !asking }" title="Обычная таблица: данные — свои" @click="detach">Обычная</button>
        <button :class="{ on: !!t.from || asking }" title="Заполняется из переменной заметки (строки запроса, список из ответа, результат кода); правьте как обычную, «Отделить» — оставить данные себе" @click="((asking = true), (fromDraft = t.from ?? varNames[0] ?? ''))">Из переменной</button>
      </span>
      <label v-if="asking || t.from" class="bt-var" :title="source?.ok ? summary(source.value) : ''" @mousedown.stop>
        <span>{{ '{' }}{{ '{' }}</span><SuggestInput v-model="fromDraft" :options="varNames" placeholder="rows или resp.body.data" @commit="setFrom" @cancel="((asking = false), (fromDraft = t.from ?? ''))" /><span>{{ '}' }}{{ '}' }}</span>
      </label>
      <template v-if="t.from">
        <span v-if="!source?.ok" class="warn">нет значения — выполните блок, который его даёт</span>
        <button v-else-if="stale" class="pill warn" title="Значение переменной изменилось, а таблицу правили — заполнить заново (правки пропадут)" @click="fill"><Icon name="refresh" :size="12" />Обновить</button>
        <span v-else-if="edited" class="muted" title="Таблицу правили: при изменении переменной спрошу, обновлять ли">изменена</span>
        <button class="ib" title="Отделить от переменной: таблица остаётся со своими данными" @click="detach"><Icon name="scissors" :size="13" /></button>
      </template>
      <span class="seg" title="Как показать">
        <button :class="{ on: !asJson }" @click="asJson = false">Таблица</button>
        <button :class="{ on: asJson }" title="Строки как JSON: заголовки — ключи" @click="asJson = true">JSON</button>
      </span>
      <button class="ib" :class="{ on: t.wrap }" :title="t.wrap ? 'Текст в ячейках переносится — нажмите: в одну строку с «…»' : 'Текст в ячейках в одну строку, длинный — с «…» (копируется целиком). Нажмите — переносить'" @click="setWrap(!t.wrap)"><Icon name="rows" :size="13" /></button>
      <MenuButton icon="download" title="Скопировать или сохранить в Excel / CSV" :width="240" :items="exportItems" />
      <span v-if="exported" class="muted ex" :title="exported">{{ exported }}</span>
    </div>
    <div v-if="asJson" class="bt-json"><CodeArea :model-value="JSON.stringify(objects, null, 2)" lang="json" readonly :min-height="24" /></div>
    <div v-else class="bt-scroll">
      <table ref="tableEl" :class="{ fixed: fixed() }">
        <colgroup><col v-for="(_, c) in t.head" :key="c" :style="colStyle(c)" /></colgroup>
        <thead>
          <tr>
            <th v-for="(h, c) in t.head" :key="c" :style="{ textAlign: t.align[c] ?? 'left' }">
              <button class="bt-plus col" title="Вставить столбец здесь" @mousedown.prevent @click="(addCol(c + 1), focusCell(-1, c + 1))"><Icon name="plus" :size="11" /></button>
              <span class="bt-rz" title="Потяните — ширина столбца · двойной клик — по содержимому" @pointerdown="dragWidth(c, $event)" @dblclick="autoWidth(c)"></span>
              <textarea v-if="isEdit(-1, c)" :data-rc="`-1:${c}`" :value="h" rows="1" spellcheck="false" :style="{ textAlign: t.align[c] ?? 'left' }" @input="setCell(-1, c, ($event.target as HTMLTextAreaElement).value)" @keydown="onKey($event, -1, c)" @focus="onFocusCell(-1, c)" @blur="leaveCell(-1, c)"></textarea>
              <div v-else class="cv" :class="{ wrap: t.wrap }" :style="{ textAlign: t.align[c] ?? 'left' }" :title="!t.wrap && h.length > 24 ? h : undefined" @click="focusCell(-1, c)">{{ h || '\u00a0' }}</div>
              <button class="bt-cm" title="Столбец: вставить, выровнять, сортировать, удалить" @mousedown.prevent @click="openMenu('col', c, $event)"><Icon name="chevronDown" :size="12" /></button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in t.rows" :key="r">
            <template v-for="(cell, c) in row" :key="c">
            <td v-if="!coveredBy(t, r, c)" v-bind="span(r, c)" :class="{ sel: inSel(r, c), tolast: (mergeAt(t, r, c)?.rs ?? 1) + r === t.rows.length, lastcol: c + (mergeAt(t, r, c)?.cs ?? 1) === t.head.length, merged: !!mergeAt(t, r, c) }" @pointerdown="cellDown($event, r, c)" @pointerenter="cellEnter(r, c)" @contextmenu="onCellMenu($event, r, c)">
              <template v-if="c === firstShown(r)">
                <button class="bt-rh" title="Строка: вставить, удалить" @mousedown.prevent @click="openMenu('row', r, $event)"><Icon name="grip" :size="12" /></button>
                <button class="bt-plus row" title="Вставить строку здесь" @mousedown.prevent @click="(addRow(r + 1), focusCell(r + 1, 0))"><Icon name="plus" :size="11" /></button>
              </template>
              <textarea v-if="isEdit(r, c)" :data-rc="`${r}:${c}`" :value="cell" rows="1" spellcheck="false" :style="{ textAlign: mergeAt(t, r, c) ? 'center' : (t.align[c] ?? 'left') }" @input="setCell(r, c, ($event.target as HTMLTextAreaElement).value)" @keydown="onKey($event, r, c)" @focus="onFocusCell(r, c)" @blur="leaveCell(r, c)"></textarea>
              <div v-else class="cv" :class="{ wrap: t.wrap }" :style="{ textAlign: mergeAt(t, r, c) ? 'center' : (t.align[c] ?? 'left') }" :title="!t.wrap && cell.length > 24 ? cell.slice(0, 2000) : undefined">{{ cell || '\u00a0' }}</div>
            </td>
            </template>
          </tr>
        </tbody>
        <tfoot v-if="sums.length">
          <tr>
            <td v-for="(_, c) in t.head" :key="c" :style="{ textAlign: t.align[c] ?? 'left' }">
              <span v-if="sumOf(c)" class="bt-sum" :title="sumTitle(c)">Σ {{ fmtSum(sumOf(c)!.sum) }}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div v-if="selCells > 1 || curMerge" class="bt-bar" @mousedown.prevent>
      <button v-if="selCells > 1" @click="doMerge"><Icon name="layers" :size="13" />Объединить ячейки ({{ selCells }})</button>
      <button v-else-if="curMerge" @click="doUnmerge"><Icon name="layers" :size="13" />Разъединить</button>
      <span v-if="selCells > 1" class="hint">Esc — отменить выбор</span>
    </div>
    <ContextMenu v-if="cellMenu" :x="cellMenu.x" :y="cellMenu.y" :items="cellItems" @close="cellMenu = undefined" />
    <Teleport to="body">
      <div v-if="menu" ref="menuEl" class="bt-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px`, width: `${MENU_W}px` }">
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
          <button :disabled="!!t.merges?.length" :title="t.merges?.length ? 'В таблице есть объединённые ячейки' : ''" @click="act(() => sortBy(menu!.i, 1))"><Icon name="sort" :size="13" />Сортировать по возрастанию</button>
          <button :disabled="!!t.merges?.length" :title="t.merges?.length ? 'В таблице есть объединённые ячейки' : ''" @click="act(() => sortBy(menu!.i, -1))"><Icon name="sort" :size="13" />Сортировать по убыванию</button>
          <button :class="{ on: t.sums?.includes(menu.i) }" @click="act(() => toggleSum(menu!.i))"><span class="bt-sig">Σ</span>{{ t.sums?.includes(menu.i) ? 'Убрать сумму' : 'Сумма по столбцу' }}</button>
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
/* the table's type, its value, its view, its export: one line over it */
.bt-tools {
  position: relative;
  z-index: 4;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.bt-tools .seg {
  display: inline-flex;
  flex: none;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  overflow: hidden;
}
.bt-tools .seg button {
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
}
.bt-tools .seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.bt-var {
  display: inline-flex;
  align-items: center;
  height: 24px;
  min-width: 0;
  padding: 0 6px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--dim);
  font-family: var(--font-data);
}
.bt-var :deep(input) {
  width: 170px;
  min-width: 0;
  height: 22px;
  padding: 0 3px;
  border: 0;
  background: transparent;
  color: var(--accent-fg);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.bt-tools .warn {
  color: var(--warn-fg);
}
.bt-tools .muted {
  color: var(--muted);
}
.bt-tools .ex {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bt-tools .grow {
  flex: 1;
}
.bt-tools .ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.bt-tools .ib.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.bt-tools .ib:hover {
  background: var(--hover);
  color: var(--text);
}
.bt-tools .pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid currentColor;
  border-radius: 11px;
  background: transparent;
  font-size: 11.5px;
}
.bt-json :deep(.cm-editor) {
  max-height: 420px;
}
.bt {
  position: relative;
  /* its own box for margins: the room for the handles left of the table (a negative margin below) stays inside it */
  display: flow-root;
  /* as wide as the note — a wide table scrolls inside, never widens the note */
  contain: inline-size;
  min-width: 0;
}
/* room around the table for its «+» and handles (they stand on its borders); under the tools, never over them */
.bt-scroll {
  position: relative;
  max-width: calc(100% + 24px);
  /* (on the right — the note's edge: a wide table scrolls inside it, never past it) */
  margin: 0 0 -10px -24px;
  padding: 10px 12px 10px 24px;
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
tbody tr {
  position: relative;
}
th,
td {
  min-width: 90px;
  max-width: 420px;
}
td.sel {
  background: rgb(var(--accent-rgb) / 0.16);
}
td.sel textarea {
  user-select: none;
}
tfoot td {
  border-top: 1px solid var(--border-2);
  border-bottom: 0;
  background: var(--panel-2);
}
.bt-sum {
  display: block;
  padding: 5px 10px;
  color: var(--accent-fg);
  font-family: var(--font-data);
  font-size: 0.95em;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.bt-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.bt-bar button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}
.bt-bar .hint {
  color: var(--muted);
  font-size: 11.5px;
}
.bt-sig {
  width: 13px;
  font-weight: 700;
  text-align: center;
}
.bt-menu button.on {
  color: var(--accent-fg);
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
td.lastcol,
tfoot td:last-child {
  border-right: 0;
}
/* a merged cell: its text in the middle (as Excel's «merge and centre») */
td.merged {
  vertical-align: middle;
}
tbody tr:last-child td {
  border-bottom: 0;
}
/* a cell merged down to the last row: no line under it (the table's border is there) */
tbody td.tolast {
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
/* a cell as it shows (the one typed in is a field): one line cut with «…», or wrapped */
.cv {
  min-height: calc(1.45em + 14px);
  max-width: 420px;
  padding: 7px 26px 7px 10px;
  overflow: hidden;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}
.cv.wrap {
  white-space: pre-wrap;
  word-break: break-word;
}
table.fixed .cv {
  max-width: none;
}
th .cv {
  color: var(--text-hi);
  font-weight: 600;
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
  top: -9px;
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
  /* (one line each: the menu is wide enough for its longest) */
  white-space: nowrap;
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
