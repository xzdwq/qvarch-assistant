import type { RunnableBlockView } from '../../ui/blockView'
import BlockPw from './BlockPw.vue'

/** A browser scenario: steps, screenshot, trace. */
export const pwView: RunnableBlockView = { component: BlockPw, props: ['src', 'path', 'line', 'onChange'], passResult: 'value' }
