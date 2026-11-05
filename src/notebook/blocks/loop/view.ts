import { blockView } from '../../ui/blockView'
import BlockLoop from './BlockLoop.vue'

/** A loop's head, its settings and passes. */
export const loopView = blockView(BlockLoop, ['src', 'path', 'line', 'onChange'])
