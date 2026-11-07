import { computed, type Ref } from 'vue'
import type { BlockInfo } from '../domain/blockInfo'

/** Whether a block takes part in the batch runs, and how that is switched (RunHead's toggle). */
export interface BatchToggle {
  inBatch: boolean
  set(on: boolean): void
}

/** A fenced block's part in the batch runs: its `skip` flag read and written in its info line. */
export function batchToggle(fence: { info: Ref<BlockInfo>; patchInfo(p: Partial<BlockInfo>): void }) {
  return computed<BatchToggle>(() => ({
    inBatch: !fence.info.value.skip,
    set: (on) => fence.patchInfo({ skip: on ? undefined : true }),
  }))
}
