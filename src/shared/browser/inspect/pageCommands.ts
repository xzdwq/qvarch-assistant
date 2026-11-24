/**
 * What main asks the inspector in a page (its preload — src/preload/page/inspector.ts): one command, one answer.
 * The «target» is the element the menu is about: the one pinned, else the one right-clicked last.
 */

/** How an element is hidden: display: none !important, visibility: hidden !important, taken out of the page. */
export const HIDE_WAYS = ['display', 'visibility', 'remove'] as const
export type HideWay = (typeof HIDE_WAYS)[number]
export const HIDE_WORDS: Record<HideWay, string> = {
  display: 'Скрыть (display: none !important)',
  visibility: 'Спрятать, оставив место (visibility: hidden)',
  remove: 'Удалить из DOM',
}
/** Where the pin goes: the target's parent, its first child, the target itself, none. */
export const PIN_MOVES = ['parent', 'child', 'here', 'none'] as const
export type PinMove = (typeof PIN_MOVES)[number]

export type InspectCommand =
  | { t: 'target' }
  | { t: 'hide'; how: HideWay }
  | { t: 'restore' }
  | { t: 'edit' }
  | { t: 'pin'; to: PinMove }
  | { t: 'mark'; selector: string; scroll: boolean }
  | { t: 'unmark' }
  | { t: 'text' }
  | { t: 'xpath' }
  | { t: 'locator' }

/**
 * The target as the page describes it: in words, its size, its box (the page's CSS px: in the window — `view`, in
 * the document — `doc`), how to find it from a point (the element at `point`, then `up` parents), the page's state.
 */
export interface TargetInfo {
  label: string
  width: number
  height: number
  view: { x: number; y: number; width: number; height: number }
  doc: { x: number; y: number; width: number; height: number }
  point: { x: number; y: number }
  up: number
  pinned: boolean
  editing: boolean
  /** Elements hidden / removed on the page so far (to bring back). */
  hidden: number
}
