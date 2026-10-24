import type { BlockView } from '../../ui/blockView'
import BlockFiles from './BlockFiles.vue'

/** A set of test files. */
export const filesView: BlockView = { component: BlockFiles, props: ['src', 'path', 'onChange'] }
