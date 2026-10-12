import type { Ms } from './types'

/** Key presses closer than this keep the combo going; a longer pause starts it from zero. */
export const COMBO_GAP_MS = 3000

/** Typing combo: the current streak and the best one of the day. Only counts — never which keys. */
export interface ComboState {
  current: number
  /** Moment of the last press. */
  last: Ms
  best: number
  bestAt?: Ms
}

export const emptyCombo = (): ComboState => ({ current: 0, last: 0, best: 0 })

/** Feeds press moments (ascending) into the combo; returns true when the day's best grew. */
export function pushKeys(c: ComboState, times: Ms[]): boolean {
  let improved = false
  for (const t of times) {
    if (t - c.last > COMBO_GAP_MS) c.current = 0
    c.current++
    c.last = t
    if (c.current > c.best) {
      c.best = c.current
      c.bestAt = t
      improved = true
    }
  }
  return improved
}
