import { blockView } from '../../ui/blockView'
import BlockWork from './BlockWork.vue'

/** The work over a period. */
export const workView = blockView(BlockWork, ['src', 'path', 'line', 'autofocus', 'onChange'])
