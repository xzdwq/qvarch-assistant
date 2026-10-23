import type { RunnableBlockView } from '../../ui/blockView'
import BlockTpl from './BlockTpl.vue'

/** A template and the text it fills. */
export const tplView: RunnableBlockView = { component: BlockTpl, props: ['src', 'path', 'line', 'inLoop', 'onChange'], passResult: 'markdown' }
