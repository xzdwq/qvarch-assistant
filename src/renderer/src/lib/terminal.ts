import { computed, reactive, shallowRef, watch } from 'vue'
import type { ITheme } from '@xterm/xterm'
import type { TermAlert, TermSession } from '@shared/terminal'
import { cssColor } from './cssColor'

/** The shells (their state comes from the main process), shared by the section and the status bar. */
const sessions = shallowRef<TermSession[]>([])
const alerts = shallowRef<TermAlert[]>([])
const watchError = shallowRef('')
/** The first list came (before it the tabs must not be thrown away as gone). */
export const termsLoaded = shallowRef(false)
let started = false
function start(): void {
  if (started) return
  started = true
  void window.qa.termList().then((l) => ((sessions.value = l), (termsLoaded.value = true)))
  window.qa.onTermState((l) => (sessions.value = l))
  void window.qa.termAlerts().then((a) => ((alerts.value = a.list), (watchError.value = a.watchError)))
  window.qa.onTermAlerts((a) => ((alerts.value = [...a.list]), (watchError.value = a.watchError)))
}
export function useTermSessions() {
  start()
  return sessions
}
export function useTermAlerts() {
  start()
  return { alerts, watchError }
}

/**
 * The status bar's light: a reaction fired — it blinks fast in its colour (until the notice is closed);
 * a command failed — red; something runs — green; idle — off.
 */
export type TermLight = { kind: 'alert' | 'err' | 'run' | 'idle'; color?: string; label: string; title: string }
export const termLight = computed<TermLight>(() => {
  start()
  const a = alerts.value[0]
  if (a) return { kind: 'alert', color: a.color, label: a.name, title: `«${a.name}» в ${a.title}${alerts.value.length > 1 ? ` и ещё ${alerts.value.length - 1}` : ''} — закройте уведомление в разделе «Терминал»` }
  const bad = sessions.value.filter((s) => s.failed !== undefined && !s.busy)
  if (bad.length) return { kind: 'err', label: bad[0].title, title: `Ошибка: ${bad.map((s) => `${s.title} (код ${s.failed})`).join(', ')}` }
  const run = sessions.value.filter((s) => s.busy)
  if (run.length) return { kind: 'run', label: run[0].title, title: `Выполняется: ${run.map((s) => s.title).join(', ')}` }
  return { kind: 'idle', label: '', title: `Оболочек: ${sessions.value.length}, ничего не выполняется` }
})

// ---------- the panes: one or two, each with its own tabs (like the notebook) ----------
export interface TermPaneState {
  id: string
  tabs: string[]
  active?: string
}
export interface TermLayout {
  panes: TermPaneState[]
  cur: number
  /** The first pane's share of the width. */
  split: number
}
const KEY = 'qa.term.layout'
function readLayout(): TermLayout {
  const def: TermLayout = { panes: [{ id: 'p1', tabs: [] }], cur: 0, split: 0.5 }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TermLayout> | null
    if (!v?.panes?.length) return def
    return { ...def, ...v, cur: Math.min(v.cur ?? 0, v.panes.length - 1) }
  } catch {
    return def
  }
}
export const termLayout = reactive<TermLayout>(readLayout())
watch(
  termLayout,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(termLayout))
    } catch {
      // not remembered — fine
    }
  },
  { deep: true },
)
/** The tabs follow the shells: closed ones go, ones nobody shows (a window drawn again) join the current pane. */
export function syncLayout(list: TermSession[]): void {
  const ids = new Set(list.map((s) => s.id))
  for (const p of termLayout.panes) {
    p.tabs = p.tabs.filter((t) => ids.has(t))
    if (!p.active || !p.tabs.includes(p.active)) p.active = p.tabs[p.tabs.length - 1]
  }
  const shown = new Set(termLayout.panes.flatMap((p) => p.tabs))
  const cur = termLayout.panes[termLayout.cur] ?? termLayout.panes[0]
  for (const s of list) if (!shown.has(s.id)) cur.tabs.push(s.id)
  if (!cur.active) cur.active = cur.tabs[0]
  // an empty second pane goes away
  if (termLayout.panes.length > 1) {
    const i = termLayout.panes.findIndex((p) => !p.tabs.length)
    if (i >= 0) {
      termLayout.panes.splice(i, 1)
      termLayout.cur = 0
    }
  }
}
export function addTab(pi: number, id: string): void {
  const p = termLayout.panes[pi] ?? termLayout.panes[0]
  if (!p.tabs.includes(id)) {
    const at = p.active ? p.tabs.indexOf(p.active) : -1
    p.tabs.splice(at < 0 ? p.tabs.length : at + 1, 0, id)
  }
  p.active = id
  termLayout.cur = termLayout.panes.indexOf(p)
}
/** A tab dragged onto another place (in its pane or the other one). */
export function moveTermTab(from: number, id: string, to: number, index: number): void {
  const a = termLayout.panes[from]
  const b = termLayout.panes[to]
  if (!a || !b) return
  const i = a.tabs.indexOf(id)
  if (i < 0) return
  a.tabs.splice(i, 1)
  if (a === b) b.tabs.splice(index > i ? index - 1 : index, 0, id)
  else {
    b.tabs.splice(Math.min(index, b.tabs.length), 0, id)
    if (a.active === id) a.active = a.tabs[Math.min(i, a.tabs.length - 1)]
  }
  b.active = id
  termLayout.cur = to
  if (!a.tabs.length && termLayout.panes.length > 1 && a !== b) {
    termLayout.panes.splice(from, 1)
    termLayout.cur = 0
  }
}
/** A tab dropped at a pane's edge: the panes split, the tab goes to the new side. */
export function splitTermWith(from: number, id: string, side: 'left' | 'right'): void {
  if (termLayout.panes.length > 1) return
  // the only tab can't leave its pane empty — the new side would take everything
  if (termLayout.panes[from].tabs.length < 2) return
  const pane: TermPaneState = { id: `p${Date.now()}`, tabs: [] }
  if (side === 'right') {
    termLayout.panes.push(pane)
    moveTermTab(from, id, 1, 0)
  } else {
    termLayout.panes.unshift(pane)
    moveTermTab(from + 1, id, 0, 0)
  }
}

/** Which CSS variable each of xterm's colours is (the ANSI ones: styles/colors/integrations.css). */
const XTERM_COLOR_VARS = {
  background: '--bg',
  foreground: '--text',
  cursor: '--accent',
  cursorAccent: '--bg',
  selectionBackground: '--ansi-selection',
  black: '--ansi-black',
  brightBlack: '--ansi-bright-black',
  red: '--ansi-red',
  brightRed: '--ansi-bright-red',
  green: '--ansi-green',
  brightGreen: '--ansi-bright-green',
  yellow: '--ansi-yellow',
  brightYellow: '--ansi-bright-yellow',
  blue: '--ansi-blue',
  brightBlue: '--ansi-bright-blue',
  magenta: '--ansi-magenta',
  brightMagenta: '--ansi-bright-magenta',
  cyan: '--ansi-cyan',
  brightCyan: '--ansi-bright-cyan',
  white: '--ansi-white',
  brightWhite: '--ansi-bright-white',
} as const satisfies Partial<Record<keyof ITheme, `--${string}`>>

/** The app's colours for xterm, concrete (read from the theme's variables, so a theme change shows on the next open). */
export function termTheme(): ITheme {
  return Object.fromEntries(Object.entries(XTERM_COLOR_VARS).map(([key, cssVar]) => [key, cssColor(cssVar)]))
}
