import { blockView } from '../../ui/blockView'
import BlockToc from './BlockToc.vue'

/** The note's headings; a click goes to the section. */
export const tocView = blockView(BlockToc, ['headings', 'onGo'])
