import type { BlockView } from '../../ui/blockView'
import BlockLoop from './BlockLoop.vue'

/** A loop's head, its settings and passes. */
export const loopView: BlockView = { component: BlockLoop, props: ['src', 'path', 'line', 'onChange'] }
