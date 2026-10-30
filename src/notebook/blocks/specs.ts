import type { BlockKind, BlockSpec } from '../domain/blockSpec'
import { audioSpec } from './audio/spec'
import { boardSpec } from './board/spec'
import { browserSpec } from './browser/spec'
import { calloutSpec } from './callout/spec'
import { chartSpec } from './chart/spec'
import { chatSpec } from './chat/spec'
import { chatfeedSpec } from './chatfeed/spec'
import { codeSpec } from './code/spec'
import { dataSpec } from './data/spec'
import { filesSpec } from './files/spec'
import { httpSpec } from './http/spec'
import { imageSpec } from './image/spec'
import { loopSpec } from './loop/spec'
import { loopEndSpec } from './loopEnd/spec'
import { mermaidSpec } from './mermaid/spec'
import { pwSpec } from './pw/spec'
import { refSpec } from './ref/spec'
import { regressSpec } from './regress/spec'
import { sqlSpec } from './sql/spec'
import { tableSpec } from './table/spec'
import { tocSpec } from './toc/spec'
import { cronSpec } from './cron/spec'
import { saveSpec } from './save/spec'
import { toggleSpec } from './toggle/spec'
import { tplSpec } from './tpl/spec'
import { workSpec } from './work/spec'

/**
 * The registry of note block kinds: one spec per kind (its folder holds the spec, the runner and the view). Pure —
 * the main process and tests use it too. The key set is checked against BlockKind by the compiler.
 */
export const BLOCK_SPECS = {
  table: tableSpec,
  chart: chartSpec,
  mermaid: mermaidSpec,
  toc: tocSpec,
  cron: cronSpec,
  callout: calloutSpec,
  toggle: toggleSpec,
  work: workSpec,
  audio: audioSpec,
  image: imageSpec,
  board: boardSpec,
  chat: chatSpec,
  chatfeed: chatfeedSpec,
  http: httpSpec,
  code: codeSpec,
  data: dataSpec,
  ref: refSpec,
  pw: pwSpec,
  browser: browserSpec,
  regress: regressSpec,
  files: filesSpec,
  sql: sqlSpec,
  tpl: tplSpec,
  save: saveSpec,
  loop: loopSpec,
  loopEnd: loopEndSpec,
} satisfies { readonly [K in BlockKind]: BlockSpec<K> }

/** Every spec, in the registry's order. */
export const ALL_BLOCK_SPECS: readonly BlockSpec[] = Object.values(BLOCK_SPECS)

/** A kind's spec. */
export const blockSpec = <K extends BlockKind>(kind: K): BlockSpec<K> => BLOCK_SPECS[kind] as BlockSpec<K>

/** The kinds that run as steps of «Выполнить всё» and of a loop's pass — those whose spec is a RunnableBlockSpec. */
export type RunnableKind = { [K in BlockKind]: (typeof BLOCK_SPECS)[K] extends { runnable: true } ? K : never }[BlockKind]
export const RUNNABLE_KINDS = ALL_BLOCK_SPECS.filter((s) => s.runnable).map((s) => s.kind) as readonly RunnableKind[]
export const isRunnableKind = (kind: BlockKind): kind is RunnableKind => !!BLOCK_SPECS[kind].runnable
