import { blockView } from '../../ui/blockView'
import BlockRegress from './BlockRegress.vue'

/** A folder's tests run one after another. */
export const regressView = blockView(BlockRegress, ['src', 'path', 'onChange'])
