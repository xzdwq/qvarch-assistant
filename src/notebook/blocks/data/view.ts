import { blockView } from '../../ui/blockView'
import BlockData from './BlockData.vue'

/** Data (JSON / YAML) published under its name. */
export const dataView = blockView(BlockData, ['src', 'path', 'onChange'])
