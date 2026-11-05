import { runnableView } from '../../ui/blockView'
import BlockCode from './BlockCode.vue'

/** Code and what it returned. */
export const codeView = runnableView(BlockCode, ['src', 'path', 'line', 'onChange'], 'value')
