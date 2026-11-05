import { blockView } from '../../ui/blockView'
import BlockChat from './BlockChat.vue'

/** A chat shown live: its messages and the input. */
export const chatView = blockView(BlockChat, ['src', 'onChange'])
