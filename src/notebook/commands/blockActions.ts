import { BLOCK_SPECS, isRunnableKind } from '../blocks/specs'
import type { BlockKind } from '../domain/blockSpec'

/**
 * What can be done to the note's blocks from their handle — one block or several chosen ones (Ctrl / Shift + click
 * on the handles). The menu shows the actions the chosen blocks allow, by what they can do (run, be edited as
 * Markdown), never by their kind; the editor carries the action out.
 */

/** What the chosen blocks can do together. */
export interface BlockCaps {
  count: number
  /** How many of them run (HTTP, SQL, code…). */
  runnable: number
  /** Every one of them is edited as Markdown (one block only). */
  rawEditable: boolean
}
export function blockCaps(kinds: readonly BlockKind[]): BlockCaps {
  return { count: kinds.length, runnable: kinds.filter(isRunnableKind).length, rawEditable: kinds.every((k) => !!BLOCK_SPECS[k].rawEditable) }
}

/** The actions, in the menu's order. */
export const BLOCK_ACTION_IDS = ['run', 'copy', 'dup', 'raw', 'del'] as const
export type BlockActionId = (typeof BLOCK_ACTION_IDS)[number]

/** «3 блока», «5 блоков». */
export function blocksWord(n: number): string {
  const w = n % 10 === 1 && n % 100 !== 11 ? 'блок' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'блока' : 'блоков'
  return `${n} ${w}`
}

interface BlockActionDef {
  icon: string
  /** Its line in the menu (`title` — the block's kind, when it is one block). */
  label(c: BlockCaps, title: string): string
  /** Offered for these blocks. */
  shows(c: BlockCaps): boolean
  /** Under a line, in red. */
  danger?: boolean
}
export const BLOCK_ACTIONS: Record<BlockActionId, BlockActionDef> = {
  run: { icon: 'play', label: (c) => (c.count > 1 ? `Выполнить по порядку: ${blocksWord(c.runnable)}` : 'Выполнить'), shows: (c) => c.runnable > 0 },
  copy: { icon: 'copy', label: (c) => (c.count > 1 ? `Копировать ${blocksWord(c.count)}` : 'Копировать'), shows: () => true },
  dup: { icon: 'layers', label: (c) => (c.count > 1 ? `Дублировать ${blocksWord(c.count)}` : 'Дублировать'), shows: () => true },
  raw: { icon: 'code', label: () => 'Изменить как Markdown', shows: (c) => c.count === 1 && c.rawEditable },
  del: { icon: 'trash', label: (c, title) => (c.count > 1 ? `Удалить ${blocksWord(c.count)}` : `Удалить ${title.toLowerCase()}`), shows: () => true, danger: true },
}
/** The handle menu's lines for these blocks. */
export function blockActionsFor(c: BlockCaps, title: string): Array<{ id: BlockActionId; icon: string; label: string; danger: boolean }> {
  return BLOCK_ACTION_IDS.filter((id) => BLOCK_ACTIONS[id].shows(c)).map((id) => ({ id, icon: BLOCK_ACTIONS[id].icon, label: BLOCK_ACTIONS[id].label(c, title), danger: !!BLOCK_ACTIONS[id].danger }))
}
