import { blockView } from '../../ui/blockView'
import BlockBrowser from './BlockBrowser.vue'

/** Live pages in tabs. */
export const browserView = blockView(BlockBrowser, ['src', 'path', 'line', 'onChange'])
