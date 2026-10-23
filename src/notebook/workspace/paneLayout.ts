import { reactive, watch } from 'vue'
import type { SortMode } from '@shared/vaultTree'
import { doc, save } from './noteDocs'

/**
 * The notebook's panes and tabs, and the screen's layout (the side's width and tab, the tree's open folders and
 * order, the text's scale) — remembered between runs.
 */
export interface Tab {
  path: string
  mode: 'edit' | 'read'
}
export interface Pane {
  id: string
  tabs: Tab[]
  active?: string
}
interface Layout {
  panes: Pane[]
  cur: number
  /** The left pane's share when split. */
  split: number
  side: number
  open: string[]
  sideTab: 'files' | 'search'
  /** The text's scale, % (Ctrl + wheel). */
  zoom: number
  sort: SortMode
  /** The files panel is hidden. */
  sideHidden?: boolean
  /** The note's text over the whole width (margins at its sides), else a column of 820 px. */
  wide?: boolean
}
const KEY = 'qa.nb'
function readLayout(): Layout {
  const def: Layout = { panes: [{ id: 'p1', tabs: [] }], cur: 0, split: 0.5, side: 260, open: [], sideTab: 'files', zoom: 100, sort: 'name' }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Layout> | null
    if (!v?.panes?.length) return def
    return { ...def, ...v, cur: Math.min(v.cur ?? 0, v.panes.length - 1) }
  } catch {
    return def
  }
}
export const layout = reactive<Layout>(readLayout())
watch(
  layout,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      // not remembered — fine
    }
  },
  { deep: true },
)
export const curPane = () => layout.panes[layout.cur] ?? layout.panes[0]
export const activePath = () => curPane()?.active
const newPaneId = () => `p${Date.now()}`

/** A note opened: in the current pane (or a given one, or a new one alongside), next to the active tab. */
export function openFile(path: string, opts: { pane?: number; newPane?: boolean } = {}): void {
  if (opts.newPane && layout.panes.length < 2) layout.panes.push({ id: newPaneId(), tabs: [] })
  const i = opts.newPane ? layout.panes.length - 1 : (opts.pane ?? layout.cur)
  const p = layout.panes[i]
  if (!p.tabs.some((t) => t.path === path)) {
    // next to the active tab
    const at = p.tabs.findIndex((t) => t.path === p.active)
    p.tabs.splice(at < 0 ? p.tabs.length : at + 1, 0, { path, mode: 'edit' })
  }
  p.active = path
  layout.cur = i
  doc(path)
  // its folders open in the tree
  const parts = path.split('/')
  for (let k = 1; k < parts.length; k++) {
    const dir = parts.slice(0, k).join('/')
    if (!layout.open.includes(dir)) layout.open.push(dir)
  }
}
/** A tab closed (its text saved first); an empty second pane goes away. */
export function closeTab(pi: number, path: string): void {
  const p = layout.panes[pi]
  if (!p) return
  void save(path)
  const i = p.tabs.findIndex((t) => t.path === path)
  if (i < 0) return
  p.tabs.splice(i, 1)
  if (p.active === path) p.active = p.tabs[Math.min(i, p.tabs.length - 1)]?.path
  // an empty second pane goes away
  if (!p.tabs.length && layout.panes.length > 1) {
    layout.panes.splice(pi, 1)
    layout.cur = 0
  }
}
/** Every tab of a path (or of anything under a folder) closed. */
export function closeEverywhere(path: string): void {
  for (let i = layout.panes.length - 1; i >= 0; i--)
    for (const t of [...layout.panes[i].tabs]) if (t.path === path || t.path.startsWith(path + '/')) closeTab(i, t.path)
}
/** The active note in a second pane alongside (or the second pane closes). */
export function toggleSplit(): void {
  if (layout.panes.length > 1) {
    const [a, b] = layout.panes
    for (const t of b.tabs) if (!a.tabs.some((x) => x.path === t.path)) a.tabs.push(t)
    layout.panes.splice(1, 1)
    layout.cur = 0
    return
  }
  const path = activePath()
  layout.panes.push({ id: newPaneId(), tabs: path ? [{ path, mode: 'edit' }] : [], active: path })
  layout.cur = 1
}
/** The active tab of a pane shows its linked file instead (a note ↔ its board), in the same place. */
export function swapTab(pi: number, to: string): void {
  const p = layout.panes[pi]
  if (!p?.active) return
  const from = p.active
  const i = p.tabs.findIndex((t) => t.path === from)
  if (p.tabs.some((t) => t.path === to)) p.tabs.splice(i, 1)
  else p.tabs[i] = { path: to, mode: 'edit' }
  p.active = to
  doc(to)
}
/** A tab dropped at the edge: the panes split, the tab goes to the new side. */
export function splitWith(fromPane: number, path: string, side: 'left' | 'right'): void {
  if (layout.panes.length > 1) return
  const pane = { id: newPaneId(), tabs: [] as Tab[], active: undefined as string | undefined }
  if (side === 'right') {
    layout.panes.push(pane)
    moveTab(fromPane, path, 1, 0)
  } else {
    layout.panes.unshift(pane)
    moveTab(fromPane + 1, path, 0, 0)
  }
}
/** A tab dragged onto another place (in its pane or the other one). */
export function moveTab(fromPane: number, path: string, toPane: number, index: number): void {
  const a = layout.panes[fromPane]
  const b = layout.panes[toPane]
  if (!a || !b) return
  const i = a.tabs.findIndex((t) => t.path === path)
  if (i < 0) return
  const [tab] = a.tabs.splice(i, 1)
  if (a === b) b.tabs.splice(index > i ? index - 1 : index, 0, tab)
  else {
    const dup = b.tabs.findIndex((t) => t.path === path)
    if (dup >= 0) b.tabs.splice(dup, 1)
    b.tabs.splice(Math.min(index, b.tabs.length), 0, tab)
    if (a.active === path) a.active = a.tabs[Math.min(i, a.tabs.length - 1)]?.path
  }
  b.active = path
  layout.cur = toPane
  if (!a.tabs.length && layout.panes.length > 1 && a !== b) {
    layout.panes.splice(fromPane, 1)
    layout.cur = 0
  }
}
