import type { BlockView } from '../../ui/blockView'
import BlockToggle from './BlockToggle.vue'

/** A fold: its title and the text it hides. */
export const toggleView: BlockView = { component: BlockToggle, props: ['src', 'autofocus', 'onChange', 'onExit'] }
