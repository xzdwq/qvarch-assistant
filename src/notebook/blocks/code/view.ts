import type { RunnableBlockView } from '../../ui/blockView'
import BlockCode from './BlockCode.vue'

/** Code and what it returned. */
export const codeView: RunnableBlockView = { component: BlockCode, props: ['src', 'path', 'line', 'onChange'], passResult: 'value' }
