import type { BlockView } from '../../ui/blockView'
import BlockRegress from './BlockRegress.vue'

/** A folder's tests run one after another. */
export const regressView: BlockView = { component: BlockRegress, props: ['src', 'path', 'onChange'] }
