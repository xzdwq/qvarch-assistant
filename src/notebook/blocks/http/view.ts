import { runnableView } from '../../ui/blockView'
import BlockHttp from './BlockHttp.vue'

/** A request and its answer. */
export const httpView = runnableView(BlockHttp, ['src', 'path', 'line', 'onChange'], 'answer')
