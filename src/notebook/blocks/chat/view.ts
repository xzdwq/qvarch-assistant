import type { BlockView } from '../../ui/blockView'
import BlockChat from './BlockChat.vue'

/** A chat shown live: its messages and the input. */
export const chatView: BlockView = { component: BlockChat, props: ['src', 'onChange'] }
