import type { BlockView } from '../../ui/blockView'
import BlockToc from './BlockToc.vue'

/** The note's headings; a click goes to the section. */
export const tocView: BlockView = { component: BlockToc, props: ['headings', 'onGo'] }
