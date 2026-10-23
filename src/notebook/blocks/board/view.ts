import type { BlockView } from '../../ui/blockView'
import BlockBoard from './BlockBoard.vue'

/** A board shown live. */
export const boardView: BlockView = { component: BlockBoard, props: ['src', 'onChange'] }
