import { inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { ErFocus, ErLit } from '@shared/sql'

/**
 * What the cards of an ER diagram share with it: what is lit now (a card reads which of its columns are), and how they
 * tell it what is pointed at, clicked, asked for by the right button (a table's head — its menu).
 */
export interface ErContext {
  lit: ComputedRef<ErLit>
  /** Pointed at (none — nothing). */
  point(f: ErFocus | undefined): void
  /** Clicked: picked (stays lit until another pick or a click on the empty place). */
  pick(f: ErFocus): void
  /** A table's head, the right button: its menu at the pointer. */
  menu(table: string, e: MouseEvent): void
}
const KEY: InjectionKey<ErContext> = Symbol('erContext')
export const provideEr = (c: ErContext) => provide(KEY, c)
export function useEr(): ErContext {
  const c = inject(KEY)
  if (!c) throw new Error('useEr() outside an ER diagram')
  return c
}
