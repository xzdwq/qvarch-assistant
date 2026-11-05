import { blockView } from '../../ui/blockView'
import BlockFiles from './BlockFiles.vue'

/** A set of test files. */
export const filesView = blockView(BlockFiles, ['src', 'path', 'onChange'])
