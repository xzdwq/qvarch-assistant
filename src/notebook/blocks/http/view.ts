import type { RunnableBlockView } from '../../ui/blockView'
import BlockHttp from './BlockHttp.vue'

/** A request and its answer. */
export const httpView: RunnableBlockView = { component: BlockHttp, props: ['src', 'path', 'line', 'onChange'], passResult: 'answer' }
