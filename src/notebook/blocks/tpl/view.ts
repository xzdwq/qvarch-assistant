import { runnableView } from '../../ui/blockView'
import BlockTpl from './BlockTpl.vue'

/** A template and the text it fills. */
export const tplView = runnableView(BlockTpl, ['src', 'path', 'line', 'inLoop', 'onChange'], 'markdown')
