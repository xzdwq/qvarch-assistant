import type { BlockView } from '../../ui/blockView'
import BlockCallout from './BlockCallout.vue'

/** A coloured callout with its text. */
export const calloutView: BlockView = { component: BlockCallout, props: ['src', 'autofocus', 'onChange', 'onExit'] }
