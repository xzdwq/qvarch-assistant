import { computed, type ComputedRef } from 'vue'
import type { RunnableKind } from '@nb/blocks/specs'
import type { BlockInfo } from '@nb/domain/blockInfo'
import type { FenceParts } from '@nb/domain/fence'
import { blockRunKey } from '@nb/domain/noteBlocks'
import { blockReport, envAtLine, noteRun, runBlockAt, stopBlockAt, type BlockRun } from '@nb/engine'
import type { SqlMode } from '@shared/sql'
import { doc } from '@renderer/lib/notebook'

/**
 * A runnable block's run as its component sees it: its key, its last run (in a loop — the pass shown), run / stop
 * where it stands, its report, the values it sees.
 */
export function useBlockRun(props: { path: string; line: number }, kind: RunnableKind, block: { info: ComputedRef<BlockInfo>; current: () => FenceParts }) {
  const key = computed(() => blockRunKey(block.info.value.name, kind, props.line, block.info.value.id))
  const run = computed<BlockRun | undefined>(() => noteRun(props.path).runs[key.value])
  const noteText = () => doc(props.path).text
  /** Runs the block as the component holds it now. */
  function start(opts: { sqlMode?: SqlMode } = {}): Promise<boolean> {
    const { info, body } = block.current()
    return runBlockAt(props.path, noteText(), { kind, info, body, line: props.line }, opts)
  }
  /** Stops its run going on (in a loop — the pass shown's). */
  const stop = () => stopBlockAt(props.path, noteText(), { kind, info: block.current().info, line: props.line })
  /** Its last run as text to copy. */
  const report = () => {
    const { info, body } = block.current()
    return blockReport(props.path, key.value, kind, info, body)
  }
  /** The values it sees where it stands (its loop's pass shown, or the note's); a computed reading them follows them. */
  const values = () => envAtLine(props.path, props.line, noteText()).values()
  return { key, run, start, stop, report, values }
}
