import type { BlockSpec } from '../../domain/blockSpec'
import { LOOP_CLOSE } from '../../domain/loop'
import { fixedHeight, singleLine } from '../detectors'

/** A loop's end (<!-- /qa:loop -->): shown as the bottom of its loop's band; inserted together with its start. */
export const loopEndSpec: BlockSpec<'loopEnd'> = {
  kind: 'loopEnd',
  title: 'Конец цикла',
  detect: singleLine(20, LOOP_CLOSE),
  estimateHeight: fixedHeight(26),
  rawEditable: true,
}
