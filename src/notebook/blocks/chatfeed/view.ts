import type { BlockView } from '../../ui/blockView'
import BlockChatFeed from './BlockChatFeed.vue'

/** Every chat and discussion: the list, the one picked; its height kept in the block. */
export const chatfeedView: BlockView = { component: BlockChatFeed, props: ['src', 'onChange'] }
