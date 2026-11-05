import { blockView } from '../../ui/blockView'
import BlockChatFeed from './BlockChatFeed.vue'

/** Every chat and discussion: the list, the one picked; its height kept in the block. */
export const chatfeedView = blockView(BlockChatFeed, ['src', 'onChange'])
