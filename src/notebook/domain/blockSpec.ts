import type { BlockInfo } from './blockInfo'
import type { NoteCommand } from '../commands/command'

/**
 * A component of a note: what kinds there are, where one is in the text, and the description every kind
 * registers (`BlockSpec`) — how it is recognized, its name, its size before it is drawn, its «@» commands.
 */
export type BlockKind = 'table' | 'chart' | 'mermaid' | 'toc' | 'callout' | 'toggle' | 'work' | 'audio' | 'image' | 'board' | 'chat' | 'chatfeed' | 'http' | 'code' | 'data' | 'ref' | 'pw' | 'browser' | 'regress' | 'files' | 'sql' | 'tpl' | 'loop' | 'loopEnd'

/** A component found in the note's text. */
export interface NoteBlock {
  kind: BlockKind
  /** The first and the last line (1-based, inclusive). */
  line0: number
  line1: number
  /** The block's own text (all its lines). */
  src: string
}

/** A fence's opening line as the recognizers see it. */
export interface FenceHeader {
  /** The language, lower case (```Chart → chart). */
  lang: string
  /** The rest of the line after the language, as typed. */
  attrs: string
  /** The whole info line parsed (lang, name=, flags…). */
  info: BlockInfo
}

/** How a kind is found in the text. */
export type BlockDetector =
  /** A fenced block: its opening line decides (the scanner finds its closing fence). */
  | { by: 'fence'; matches(header: FenceHeader): boolean }
  /**
   * Lines of its own: `match` gives the index of the block's last line (0-based, inclusive) or undefined.
   * `order` — when it is tried, relative to the others and to fences (FENCE_SCAN_ORDER).
   */
  | { by: 'lines'; order: number; match(lines: readonly string[], i: number): number | undefined }

/** Line detectors with an order below this are tried before a fence is (a loop's start owns its head fence). */
export const FENCE_SCAN_ORDER = 30

export interface BlockSpec<K extends BlockKind = BlockKind> {
  kind: K
  /** Its name in the editor: the handle's hint, the drag label, «Удалить …». */
  title: string
  /** Its name in run reports, when it differs. */
  reportTitle?: string
  detect: BlockDetector
  /** Its height before it is drawn (px), from its text — the editor's scroll estimate. */
  estimateHeight(src: string): number
  /** It runs: a step of «Выполнить всё» and of a loop's pass (its runner is in the run engine). */
  runnable?: boolean
  /** The menu offers «Изменить как Markdown» (false: a line of its own with nothing to edit). */
  rawEditable: boolean
  /** Its «@» commands (the menu's order is set in commands/registry). */
  commands?: NoteCommand[]
  /** How an AI agent writes it: what it is for, its settings (the sample comes from its «@» command). */
  guide?: string
}

/** The spec of a kind that runs (its type marks it, so the runnable kinds are known to the compiler). */
export type RunnableBlockSpec<K extends BlockKind> = BlockSpec<K> & { runnable: true }

/** The number of lines of a block's text (height estimates go by it). */
export const lineCount = (src: string) => src.split('\n').length
