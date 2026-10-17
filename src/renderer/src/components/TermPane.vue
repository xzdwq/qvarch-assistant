<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { crumbs, type TermSession } from '@shared/terminal'
import { formatDuration } from '@shared/timeline'
import { placeFloat, useAnchor } from '../lib/floating'
import { termTheme } from '../lib/terminal'
import Icon from './Icon.vue'

/**
 * One shell on screen: over it the line of its place (each folder a click away; ›  — the folders inside),
 * the git branch, node / npm / pnpm, how long the last command took; under it the terminal itself.
 */
const props = defineProps<{ session: TermSession; fontSize: number; active?: boolean }>()
const emit = defineEmits<{ focus: []; zoom: [dir: 1 | -1] }>()

const box = ref<HTMLElement>()
let term: Terminal | undefined
let fit: FitAddon | undefined
let ro: ResizeObserver | undefined
let off: (() => void) | undefined

function fitNow(): void {
  const el = box.value
  // hidden (another section is open) — nothing to measure
  if (!term || !fit || !el || !el.clientWidth || !el.clientHeight) return
  try {
    fit.fit()
    window.qa.termResize(props.session.id, term.cols, term.rows)
  } catch {
    // not laid out yet
  }
}
onMounted(async () => {
  term = new Terminal({
    // the oh-my-posh glyphs come from an installed Nerd Font (Chromium falls back glyph by glyph)
    fontFamily: "'JetBrains Mono Variable', 'FantasqueSansMono Nerd Font Mono', 'FantasqueSansMono Nerd Font', 'DaddyTimeMono Nerd Font Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'Cascadia Mono', Consolas, monospace",
    fontSize: props.fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowProposedApi: true,
    scrollback: 10000,
    theme: termTheme(),
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon((_e, uri) => window.qa.openExternal(uri)))
  term.open(box.value!)
  // (the development pictures drive it: the snap steps reach the terminal through its box)
  ;(box.value as HTMLElement & { qaTerm?: Terminal }).qaTerm = term
  // what the shell printed before this pane was drawn; what comes meanwhile waits (and is not drawn twice)
  let upto = -1
  const early: Array<[string, number]> = []
  off = window.qa.onTermData((id, d, end) => {
    if (id !== props.session.id) return
    if (upto < 0) early.push([d, end])
    else if (end > upto) term?.write(end - d.length < upto ? d.slice(upto - (end - d.length)) : d)
  })
  const r = await window.qa.termReplay(props.session.id)
  if (!term) return
  if (r.buf) term.write(r.buf)
  upto = r.upto
  for (const [d, end] of early) if (end > upto) term.write(end - d.length < upto ? d.slice(upto - (end - d.length)) : d)
  early.length = 0
  term.onData((d) => window.qa.termWrite(props.session.id, d))
  // Ctrl+C with a selection — copy; Ctrl+V — paste (the shell gets the text)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (e.ctrlKey && e.code === 'KeyC' && term?.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    if (e.ctrlKey && e.code === 'KeyV') {
      void navigator.clipboard.readText().then((t) => t && window.qa.termWrite(props.session.id, t))
      return false
    }
    // a piece of the typed command selected with the mouse: Backspace / Delete remove it, Ctrl+X cuts it
    if (term?.hasSelection() && (e.key === 'Backspace' || e.key === 'Delete' || (e.ctrlKey && e.code === 'KeyX'))) {
      if (cutSelection(e.ctrlKey && e.code === 'KeyX')) return false
      if (e.key !== 'Backspace' && e.key !== 'Delete') return true
      term.clearSelection()
    }
    return true
  })
  // right click: a selection — copied; none — the clipboard pasted (as in Windows Terminal)
  box.value!.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (!term) return
    if (term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
    } else void navigator.clipboard.readText().then((t) => t && window.qa.termWrite(props.session.id, t))
    term.focus()
  })
  // a click in the command being typed puts the cursor there (a drag stays a selection)
  let down: { x: number; y: number } | undefined
  box.value!.addEventListener('mousedown', (e) => e.button === 0 && (down = { x: e.clientX, y: e.clientY }))
  box.value!.addEventListener('mouseup', (e) => {
    const d = down
    down = undefined
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) return
    setTimeout(() => clickToCursor(e.clientX, e.clientY))
  })
  ro = new ResizeObserver(() => requestAnimationFrame(fitNow))
  ro.observe(box.value!)
  await nextTick()
  fitNow()
  if (props.active) term.focus()
})
// ---------- the command line with the mouse: the cursor by a click, a selected piece deleted ----------
/** The rows of the command being typed: the cursor's row and the ones wrapped with it. */
function inputRows(): { first: number; last: number } | undefined {
  if (!term || props.session.busy || term.modes.mouseTrackingMode !== 'none' || term.buffer.active.type !== 'normal') return undefined
  const b = term.buffer.active
  const cur = b.baseY + b.cursorY
  let first = cur
  while (first > 0 && b.getLine(first)?.isWrapped) first--
  let last = cur
  while (b.getLine(last + 1)?.isWrapped) last++
  return { first, last }
}
/** The cursor moved by arrows (the shell's own editing follows) to a row / column of the buffer. */
function cursorTo(row: number, col: number): void {
  if (!term) return
  const b = term.buffer.active
  const d = row * term.cols + col - ((b.baseY + b.cursorY) * term.cols + b.cursorX)
  if (!d) return
  const app = term.modes.applicationCursorKeysMode
  const key = d > 0 ? (app ? '\x1bOC' : '\x1b[C') : app ? '\x1bOD' : '\x1b[D'
  window.qa.termWrite(props.session.id, key.repeat(Math.abs(d)))
}
function clickToCursor(x: number, y: number): void {
  const rows = inputRows()
  const screen = box.value?.querySelector('.xterm-screen')
  if (!term || !rows || !screen || term.hasSelection()) return
  const r = screen.getBoundingClientRect()
  const col = Math.floor((x - r.left) / (r.width / term.cols))
  const row = term.buffer.active.viewportY + Math.floor((y - r.top) / (r.height / term.rows))
  if (row < rows.first || row > rows.last || col < 0 || col >= term.cols) return
  cursorTo(row, col)
}
/** A selection inside the command being typed: deleted (and copied, for a cut). False — it is elsewhere. */
function cutSelection(copy: boolean): boolean {
  const rows = inputRows()
  const p = term?.getSelectionPosition()
  if (!term || !rows || !p) return false
  // (the cells are counted from 0, whatever xterm's typings say; the end is the cell after the last one)
  const s = { row: p.start.y, col: p.start.x }
  const e = { row: p.end.y, col: p.end.x }
  if (s.row < rows.first || e.row > rows.last) return false
  const len = (e.row - s.row) * term.cols + (e.col - s.col)
  if (len <= 0) return false
  if (copy) void navigator.clipboard.writeText(term.getSelection())
  term.clearSelection()
  cursorTo(e.row, e.col)
  window.qa.termWrite(props.session.id, '\x7f'.repeat(len))
  return true
}
onBeforeUnmount(() => {
  off?.()
  ro?.disconnect()
  term?.dispose()
})
watch(
  () => props.fontSize,
  (s) => {
    if (!term) return
    term.options.fontSize = s
    fitNow()
  },
)
watch(
  () => props.active,
  (a) => a && term?.focus(),
)
defineExpose({
  focus: () => term?.focus(),
  clear: () => term?.clear(),
  /** Types a text into the shell (a preset): the line typed so far is dropped first. */
  type: (text: string, run: boolean) => {
    window.qa.termWrite(props.session.id, `\x1b${text}${run ? '\r' : ''}`)
    term?.focus()
  },
})
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return
  e.preventDefault()
  emit('zoom', e.deltaY < 0 ? 1 : -1)
}

// ---------- the line over the terminal ----------
const info = computed(() => props.session.info)
const parts = computed(() => crumbs(info.value.cwd))
/** Into a folder: the line typed so far is dropped, then a plain `cd` (quoted only when the path needs it). */
function go(path: string): void {
  if (props.session.busy) return
  const arg = /^[\w:\\/.-]+$/.test(path) ? path : `'${path.replace(/'/g, "''")}'`
  window.qa.termWrite(props.session.id, `\x1bcd ${arg}\r`)
  term?.focus()
}
const menu = ref<{ path: string; dirs: string[] }>()
const menuEl = ref<HTMLElement>()
const menuAnchor = ref<HTMLElement>()
const menuStyle = ref<Record<string, string>>({})
const menuOpen = computed(() => !!menu.value)
useAnchor(menuOpen, menuAnchor, () => menuAnchor.value && (menuStyle.value = placeFloat(menuAnchor.value, 260, true, 60).style))
async function openDirs(path: string, e: MouseEvent): Promise<void> {
  if (menu.value?.path === path) return void (menu.value = undefined)
  menuAnchor.value = e.currentTarget as HTMLElement
  menu.value = { path, dirs: await window.qa.termDirs(path) }
}
function pickDir(d: string): void {
  const p = menu.value!.path
  menu.value = undefined
  go(`${p.replace(/\\$/, '')}\\${d}`)
}
function onDown(e: PointerEvent): void {
  const t = e.target as Node
  if (menu.value && !menuEl.value?.contains(t) && !menuAnchor.value?.contains(t)) menu.value = undefined
}
onMounted(() => document.addEventListener('pointerdown', onDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDown, true))
const wantOk = computed(() => {
  const w = info.value.project?.nodeWanted
  const n = info.value.node
  if (!w || !n) return true
  const major = w.replace(/^[^\d]*/, '').split('.')[0]
  return !major || n.split('.')[0] === major
})
</script>

<template>
  <div class="tp" :class="{ active }" @mousedown="emit('focus')">
    <div class="tl">
      <span class="crumbs">
        <Icon name="folderOpen" :size="13" class="fi" />
        <template v-for="(c, i) in parts" :key="c.path">
          <button class="cr" :class="{ last: i === parts.length - 1 }" :disabled="session.busy" :title="`Перейти: ${c.path}`" @click="go(c.path)">{{ c.name }}</button>
          <button class="sep" :disabled="session.busy" :title="`Папки в ${c.name}`" @click="openDirs(c.path, $event)"><Icon name="chevronRight" :size="11" /></button>
        </template>
      </span>
      <span v-if="info.branch" class="seg git" :title="`Ветка git${info.dirty ? ` · изменено файлов: ${info.dirty}` : ''}`">
        <Icon name="branch" :size="12" />{{ info.branch }}<b v-if="info.dirty">±{{ info.dirty }}</b>
      </span>
      <span class="grow"></span>
      <span v-if="session.skipped" class="seg dim" :title="`Вывод шёл быстрее проверки реакций — ${Math.round(session.skipped / 1024)} КБ пропущено без проверки (терминал показал всё)`">⚠ {{ Math.round(session.skipped / 1024) }} КБ без проверки</span>
      <span v-if="session.busy" class="seg run"><i></i>выполняется</span>
      <span v-else-if="session.failed !== undefined && session.exited === undefined" class="seg bad" title="Последняя команда завершилась с ошибкой — пройдёт, когда команда выполнится успешно">ошибка · код {{ session.failed }}</span>
      <span v-else-if="session.lastMs !== undefined" class="seg dim" title="Сколько шла последняя команда">{{ session.lastMs < 1000 ? `${(session.lastMs / 1000).toFixed(1)}s` : formatDuration(session.lastMs) }}</span>
      <span v-if="info.project?.name" class="seg pkg" :title="`package.json${info.project.packageManager ? ` · ${info.project.packageManager}` : ''}`">{{ info.project.name }}<template v-if="info.project.version">@{{ info.project.version }}</template></span>
      <span v-if="info.node" class="seg node" :class="{ bad: !wantOk }" :title="info.project?.nodeWanted ? `Проект просит node ${info.project.nodeWanted}` : 'Версия node в этой оболочке'">⬢ {{ info.node }}<template v-if="!wantOk"> ≠ {{ info.project?.nodeWanted }}</template></span>
      <span v-if="info.npm" class="seg npm" title="npm">npm {{ info.npm }}</span>
      <span v-if="info.pnpm" class="seg pnpm" title="pnpm">pnpm {{ info.pnpm }}</span>
      <span v-if="session.exited !== undefined" class="seg bad">завершён ({{ session.exited }})</span>
    </div>
    <div ref="box" class="xt" @wheel="onWheel"></div>
    <Teleport to="body">
      <div v-if="menu" ref="menuEl" class="tdirs" :style="menuStyle">
        <button v-for="d in menu.dirs" :key="d" @click="pickDir(d)"><Icon name="folder" :size="12" />{{ d }}</button>
        <p v-if="!menu.dirs.length">Папок нет</p>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tp {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--bg);
  overflow: hidden;
}
.tp.active {
  border-color: var(--accent-line);
}
.tl {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  white-space: nowrap;
  overflow: hidden;
  font-family: var(--font-data);
  font-size: 11.5px;
}
.crumbs {
  /* short of room — the start of the path goes, the folder you are in stays */
  display: inline-flex;
  flex: 0 1 auto;
  justify-content: flex-end;
  align-items: center;
  min-width: 40px;
  overflow: hidden;
}
.crumbs > * {
  flex: none;
}
.fi {
  flex: none;
  margin-right: 4px;
  color: var(--warn);
}
.cr,
.sep {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--r1);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  cursor: default;
}
.cr.last {
  color: var(--text-hi);
  font-weight: 600;
}
.sep {
  padding: 0 1px;
  color: var(--dim);
}
.cr:hover:not(:disabled),
.sep:hover:not(:disabled) {
  background: var(--hover);
  color: var(--accent-fg);
}
.seg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 0 7px;
  height: 20px;
  border-radius: var(--r2);
  background: var(--panel-3);
  color: var(--text-2);
}
.seg.git {
  background: rgba(255, 183, 77, 0.14);
  color: var(--warn-fg);
}
.seg.git b {
  margin-left: 3px;
  color: var(--down-fg);
  font-weight: 600;
}
.seg.node {
  background: rgba(0, 230, 118, 0.12);
  color: var(--up-fg);
}
.seg.npm {
  background: rgba(255, 61, 61, 0.12);
  color: var(--down-fg);
}
.seg.pnpm {
  background: rgba(255, 183, 77, 0.12);
  color: var(--warn-fg);
}
.seg.pkg {
  background: rgba(68, 138, 255, 0.12);
  color: var(--info-fg);
}
.seg.dim {
  background: transparent;
  color: var(--muted);
}
.seg.bad {
  background: rgba(255, 61, 61, 0.16);
  color: var(--down-fg);
}
.seg.run {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.seg.run i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: tp-blink 1s steps(2) infinite;
}
@keyframes tp-blink {
  50% {
    opacity: 0.3;
  }
}
.grow {
  flex: 1;
}
.xt {
  flex: 1;
  min-height: 0;
  padding: 4px 0 0 6px;
}
.xt :deep(.xterm) {
  height: 100%;
}
.xt :deep(.xterm-viewport) {
  background: transparent !important;
}
.tdirs {
  display: flex;
  flex-direction: column;
  max-height: 340px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.tdirs button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
}
.tdirs button:hover {
  background: var(--hover);
}
.tdirs button svg {
  color: var(--warn);
}
.tdirs p {
  margin: 8px;
  color: var(--muted);
  font-size: 12px;
}
</style>
