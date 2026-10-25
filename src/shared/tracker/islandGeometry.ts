import { DOCK_SIDE, DOCK_STRIP, ISLAND_PANEL_WIDTH, ISLAND_PILL, ISLAND_WINDOW, type Dock } from '../island'

/**
 * The island's box without state: the pill's height, the slim docked pill's length, the shell's size
 * (pill / docked pill / panel, plus the quick-note area) and where it stands at a side edge.
 */

/** Height of the quick-note area that opens next to the pill (below it, or above when the island grows up). */
export const NOTE_H = 136
/** The pill is at least this wide while a quick note is open. */
export const NOTE_W = 440
/**
 * What may open next to the pill (below it, or above when the island grows up) and its size: the quick note, a chat
 * (its latest messages and a reply), the reminders. The pill is at least as wide as it.
 */
export const ISLAND_DRAWERS = {
  note: { w: NOTE_W, h: NOTE_H },
  chat: { w: 460, h: 340 },
  notice: { w: NOTE_W, h: 150 },
} as const satisfies Record<string, { w: number; h: number }>
export type IslandDrawer = keyof typeof ISLAND_DRAWERS

/** A side edge (the slim pill stands upright there). */
export const isSideDock = (dock: Dock | undefined): boolean => dock === 'left' || dock === 'right'

/** The pill loses a row for each hidden line (chips / totals), never below the orb. */
export function pillHeight(show: { chips: boolean; stats: boolean }): number {
  return Math.max(48, ISLAND_PILL.height - (show.chips ? 0 : 24) - (show.stats ? 0 : 17))
}

/** The slim pill's length: the handle and the dot, plus what is switched on. */
export function dockLength(show: { time: boolean; next: boolean; orb: boolean; wave: boolean }, hasNextMeeting: boolean): number {
  return Math.max(150, 64 + (show.time ? 58 : 0) + (show.next && hasNextMeeting ? 84 : 0) + (show.orb ? 34 : 0) + (show.wave ? 76 : 0))
}

export interface IslandSizeInput {
  expanded: boolean
  panelH: number
  dock?: Dock
  /** What is open next to the pill (none — nothing). */
  drawer?: IslandDrawer
  dockLen: number
  pillW: number
  pillH: number
}

/** The shell's size: the panel, the docked pill (a strip or an upright bar), or the pill (with its note area). */
export function islandSize(o: IslandSizeInput): { w: number; h: number } {
  if (o.expanded) return { w: ISLAND_PANEL_WIDTH, h: o.panelH }
  if (o.dock && !o.drawer) return isSideDock(o.dock) ? { w: DOCK_SIDE.w, h: o.dockLen } : { w: o.dockLen, h: DOCK_STRIP.h }
  const d = o.drawer ? ISLAND_DRAWERS[o.drawer] : { w: 0, h: 0 }
  return { w: Math.max(o.pillW, d.w), h: o.pillH + d.h }
}

/** At a side edge the island stands on the pill's centre (`offset` from the window's top), inside the window. */
export function shellTopAt(sideDock: boolean, offset: number, height: number): number {
  return sideDock ? Math.max(0, Math.min(ISLAND_WINDOW.height - height, Math.round(offset - height / 2))) : 0
}
