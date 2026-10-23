import type { BlockView } from '../../ui/blockView'
import BlockLoopEnd from './BlockLoopEnd.vue'

/** A loop's end. */
export const loopEndView: BlockView = { component: BlockLoopEnd, props: ['path', 'line'] }
