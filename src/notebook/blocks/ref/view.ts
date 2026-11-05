import { blockView } from '../../ui/blockView'
import BlockRef from './BlockRef.vue'

/** A value of the context shown live. */
export const refView = blockView(BlockRef, ['src', 'path', 'line', 'onChange'])
