import type { BlockView } from '../../ui/blockView'
import BlockBrowser from './BlockBrowser.vue'

/** Live pages in tabs. */
export const browserView: BlockView = { component: BlockBrowser, props: ['src', 'path', 'line', 'onChange'] }
