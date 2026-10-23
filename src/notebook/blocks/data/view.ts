import type { BlockView } from '../../ui/blockView'
import BlockData from './BlockData.vue'

/** Data (JSON / YAML) published under its name. */
export const dataView: BlockView = { component: BlockData, props: ['src', 'path', 'onChange'] }
