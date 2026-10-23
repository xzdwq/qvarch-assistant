import type { BlockView } from '../../ui/blockView'
import BlockRef from './BlockRef.vue'

/** A value of the context shown live. */
export const refView: BlockView = { component: BlockRef, props: ['src', 'path', 'line', 'onChange'] }
