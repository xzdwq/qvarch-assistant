import { blockView } from '../../ui/blockView'
import BlockBoard from './BlockBoard.vue'

/** A board shown live. */
export const boardView = blockView(BlockBoard, ['src', 'onChange'])
