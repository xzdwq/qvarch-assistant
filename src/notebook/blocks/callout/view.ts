import { blockView } from '../../ui/blockView'
import BlockCallout from './BlockCallout.vue'

/** A coloured callout with its text. */
export const calloutView = blockView(BlockCallout, ['src', 'autofocus', 'onChange', 'onExit'])
