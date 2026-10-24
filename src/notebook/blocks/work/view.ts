import type { BlockView } from '../../ui/blockView'
import BlockWork from './BlockWork.vue'

/** The work over a period. */
export const workView: BlockView = { component: BlockWork, props: ['src', 'path', 'line', 'autofocus', 'onChange'] }
