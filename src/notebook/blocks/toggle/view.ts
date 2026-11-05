import { blockView } from '../../ui/blockView'
import BlockToggle from './BlockToggle.vue'

/** A fold: its title and the text it hides. */
export const toggleView = blockView(BlockToggle, ['src', 'autofocus', 'onChange', 'onExit'])
