<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { crumbs, type TermSession } from '@shared/terminal'
import { formatDuration } from '@shared/timeline'
import { openWhile } from '../lib/usePopover'
import { termTheme } from '../lib/terminal'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

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

/** Keys that delete the selected piece of the command being typed. */
const DELETE_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete'])
/** Keys that only modify others (pressed alone they type nothing). */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Control', 'Shift', 'Alt', 'Meta'])

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
  term.loadAddon(new WebLinksAddon((_e, uri) => openUrl(uri)))
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
  // Ctrl+A in the shell: the typed line (its length, the cursor's place in it) — shown selected here too
  term.parser.registerOscHandler(633, (data) => {
    const m = /^QA;(\d+);(\d+)$/.exec(data)
    if (!m || !term) return false
    const len = Number(m[1])
    const at = Number(m[2])
    const b = term.buffer.active
    const start = (b.baseY + b.cursorY) * term.cols + b.cursorX - at
    if (len > 0 && start >= 0) term.select(start % term.cols, Math.floor(start / term.cols), len)
    return true
  })
  // Ctrl+C with a selection — copy; Ctrl+V — paste (the shell gets the text)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (e.ctrlKey && e.code === 'KeyC' && term?.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    if (e.ctrlKey && e.code === 'KeyV') {
      term?.clearSelection()
      void navigator.clipboard.readText().then((t) => t && window.qa.termWrite(props.session.id, t))
      return false
    }
    // a piece of the typed command selected with the mouse: Backspace / Delete remove it, Ctrl+X cuts it
    const cut = e.ctrlKey && e.code === 'KeyX'
    if (term?.hasSelection() && (DELETE_KEYS.has(e.key) || cut)) {
      if (cutSelection(cut)) return false
      if (!DELETE_KEYS.has(e.key)) return true
      term.clearSelection()
    }
    // a key typed over a Ctrl+A selection: the shell replaces the line, the shown selection goes
    if (term?.hasSelection() && !MODIFIER_KEYS.has(e.key) && !(e.ctrlKey && (e.code === 'KeyA' || e.code === 'KeyC'))) term.clearSelection()
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
/** The folders inside a crumb (its ›): a list under it. */
const menu = ref<{ path: string; dirs: string[] }>()
const menuAnchor = ref<HTMLElement>()
const menuOpen = openWhile(menu)
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
const wantOk = computed(() => {
  const w = info.value.project?.nodeWanted
  const n = info.value.node
  if (!w || !n) return true
  const major = w.replace(/^[^\d]*/, '').split('.')[0]
  return !major || n.split('.')[0] === major
})
</script>

<template>
  <div class="tp tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:border tw:border-border tw:rounded-r3 tw:bg-bg tw:overflow-hidden tw:[&.active]:border-accent-line" :class="{ active }" @mousedown="emit('focus')">
    <div class="tl tw:flex-none tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-b tw:border-b-border tw:bg-panel tw:whitespace-nowrap tw:overflow-hidden tw:font-data tw:text-[11.5px]">
      <span class="crumbs tw:inline-flex tw:flex-[0_1_auto] tw:justify-end tw:items-center tw:min-w-40 tw:overflow-hidden">
        <Icon name="folderOpen" :size="13" class="fi tw:[&&]:flex-none tw:mr-4 tw:text-warn" />
        <template class="tw:flex-none" v-for="(c, i) in parts" :key="c.path">
          <button class="cr tw:flex-none tw:inline-flex tw:items-center tw:h-22 tw:py-0 tw:px-4 tw:border-0 tw:rounded-r1 tw:bg-transparent tw:text-text-2 tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:font-[inherit] tw:cursor-default tw:[&.last]:text-text-hi tw:[&.last]:font-semibold tw:hover:enabled:bg-hover tw:hover:enabled:text-accent-fg tw:hover:enabled:border-border-3" :class="{ last: i === parts.length - 1 }" :disabled="session.busy" :title="`Перейти: ${c.path}`" @click="go(c.path)">{{ c.name }}</button>
          <button class="sep tw:flex-none tw:inline-flex tw:items-center tw:h-22 tw:border-0 tw:rounded-r1 tw:bg-transparent tw:[font:inherit] tw:cursor-default tw:py-0 tw:px-1 tw:text-dim tw:hover:enabled:bg-hover tw:hover:enabled:text-accent-fg tw:hover:enabled:border-border-3" :disabled="session.busy" :title="`Папки в ${c.name}`" @click="openDirs(c.path, $event)"><Icon name="chevronRight" :size="11" /></button>
        </template>
      </span>
      <span v-if="info.branch" class="seg git tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-warn/14 tw:text-warn-fg" :title="`Ветка git${info.dirty ? ` · изменено файлов: ${info.dirty}` : ''}`">
        <Icon name="branch" :size="12" />{{ info.branch }}<b class="tw:ml-3 tw:text-down-fg tw:font-semibold" v-if="info.dirty">±{{ info.dirty }}</b>
      </span>
      <span class="grow tw:flex-1"></span>
      <span v-if="session.skipped" class="seg dim tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-transparent tw:text-muted" :title="`Вывод шёл быстрее проверки реакций — ${Math.round(session.skipped / 1024)} КБ пропущено без проверки (терминал показал всё)`">⚠ {{ Math.round(session.skipped / 1024) }} КБ без проверки</span>
      <span v-if="session.busy" class="seg run tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-accent-soft tw:text-accent-fg"><i class="tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-accent tw:animate-[TermPane-tp-blink_1s_steps(2)_infinite]"></i>выполняется</span>
      <span v-else-if="session.failed !== undefined && session.exited === undefined" class="seg bad tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-down/16 tw:text-down-fg" title="Последняя команда завершилась с ошибкой — пройдёт, когда команда выполнится успешно">ошибка · код {{ session.failed }}</span>
      <span v-else-if="session.lastMs !== undefined" class="seg dim tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-transparent tw:text-muted" title="Сколько шла последняя команда">{{ session.lastMs < 1000 ? `${(session.lastMs / 1000).toFixed(1)}s` : formatDuration(session.lastMs) }}</span>
      <span v-if="info.project?.name" class="seg pkg tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-info/12 tw:text-info-fg" :title="`package.json${info.project.packageManager ? ` · ${info.project.packageManager}` : ''}`">{{ info.project.name }}<template v-if="info.project.version">@{{ info.project.version }}</template></span>
      <span v-if="info.node" class="seg node tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-up/12 tw:text-up-fg tw:[&.bad]:bg-down/16 tw:[&.bad]:text-down-fg" :class="{ bad: !wantOk }" :title="info.project?.nodeWanted ? `Проект просит node ${info.project.nodeWanted}` : 'Версия node в этой оболочке'">⬢ {{ info.node }}<template v-if="!wantOk"> ≠ {{ info.project?.nodeWanted }}</template></span>
      <span v-if="info.npm" class="seg npm tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-down/12 tw:text-down-fg" title="npm">npm {{ info.npm }}</span>
      <span v-if="info.pnpm" class="seg pnpm tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-warn/12 tw:text-warn-fg" title="pnpm">pnpm {{ info.pnpm }}</span>
      <span v-if="session.exited !== undefined" class="seg bad tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:py-0 tw:px-7 tw:h-20 tw:rounded-r2 tw:bg-down/16 tw:text-down-fg">завершён ({{ session.exited }})</span>
    </div>
    <div ref="box" class="xt tw:flex-1 tw:min-h-0 tw:pt-4 tw:pr-0 tw:pb-0 tw:pl-6" @wheel="onWheel"></div>
    <Popover v-model:open="menuOpen" :anchor="menuAnchor" :width="260" align-left :chrome="60" max-height="none" class="tdirs tw:flex tw:flex-col tw:max-h-340 tw:overflow-y-auto tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
        <button class="tw:flex tw:items-center tw:gap-7 tw:py-5 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:bg-hover" v-for="d in menu?.dirs" :key="d" @click="pickDir(d)"><Icon class="tw:text-warn" name="folder" :size="12" />{{ d }}</button>
        <p class="tw:m-8 tw:text-muted tw:text-[12px]" v-if="!menu?.dirs.length">Папок нет</p>
    </Popover>
  </div>
</template>

<style scoped src="./TermPane.css"></style>
