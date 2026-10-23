import type { BlockView } from '../../ui/blockView'
import BlockImage from './BlockImage.vue'

/** A picture of the note. */
export const imageView: BlockView = { component: BlockImage, props: ['src'] }
