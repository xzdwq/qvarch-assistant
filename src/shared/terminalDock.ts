/**
 * The one terminal and its places: the bottom panel (popped over the window or pinned into its grid) and its section
 * on the bar. Its shells are one, so it is shown in one place at a time — where it was asked
 * last; nowhere on screen — kept in the hidden panel (its shells keep running).
 */
export const TERM_PLACES = ['dock', 'section'] as const
export type TermPlace = (typeof TERM_PLACES)[number]

export interface TermDockState {
  /** The panel is open (its button in the status line, its ×). */
  open: boolean
  /** Where the terminal was asked last: the panel's button, or its section opened. */
  asked: TermPlace
  /** Its section is on screen. */
  sectionShown: boolean
}

/** The panel on screen: open, and asked last — or its section not on screen (nothing to make way for). */
export const dockShown = (s: TermDockState): boolean => s.open && (s.asked === 'dock' || !s.sectionShown)
/** Where the terminal is now. */
export const termPlaceOf = (s: TermDockState): TermPlace => (dockShown(s) ? 'dock' : s.sectionShown ? 'section' : 'dock')

/** The panel's height: its least, its first; what of the window it leaves — the app's head, the status line, a strip above. */
export const DOCK_H = { min: 120, start: 320, keep: 182 } as const
/** The panel's height within the window (a smaller window — a lower panel, the kept height stays for a bigger one). */
export const dockHeight = (h: number, windowH: number): number => Math.max(DOCK_H.min, Math.min(Number.isFinite(h) ? h : DOCK_H.start, windowH - DOCK_H.keep))
