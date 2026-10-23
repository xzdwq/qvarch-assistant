import type { CellGrid } from './cellGrid'

/** A cell that reads as a number or a date (a head is words: «Сумма», «Дата»). */
const looksLikeValue = (s: string) => /^[+-]?[\d\s .,:/%-]+$/.test(s.trim())

/**
 * Is the grid's first row its head — a guess for the choice offered (the person decides): rows below it, and every
 * cell of it written (a merged one counts by its first cell) and none of them a number or a date.
 */
export function guessHeadRow(g: CellGrid): boolean {
  if (g.rows.length < 2) return false
  const covered = (c: number) => g.merges.some((m) => m.r === 0 && c > m.c && c < m.c + m.cs)
  const first = g.rows[0].filter((_, c) => !covered(c))
  return first.length > 0 && first.every((s) => s.trim() && !looksLikeValue(s))
}
