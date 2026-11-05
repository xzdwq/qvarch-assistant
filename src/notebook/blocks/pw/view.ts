import { runnableView } from '../../ui/blockView'
import BlockPw from './BlockPw.vue'

/** A browser scenario: steps, screenshot, trace. */
export const pwView = runnableView(BlockPw, ['src', 'path', 'line', 'onChange'], 'value')
