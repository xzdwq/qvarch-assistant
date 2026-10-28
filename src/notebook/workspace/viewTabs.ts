/**
 * Tabs that are views, not files (the notebook's graph): opened, moved, kept and closed as a note's tab is, but never
 * read from the disk, saved, recorded into — each by its own path (`qa:<view>`), which no file of the vault can have.
 */
export const VIEW_TABS = {
  'qa:graph': { title: 'Граф блокнота', icon: 'branch' },
} as const
export type ViewTab = keyof typeof VIEW_TABS
export const GRAPH_TAB: ViewTab = 'qa:graph'

export const isViewTab = (path: string | undefined): path is ViewTab => !!path && Object.hasOwn(VIEW_TABS, path)
