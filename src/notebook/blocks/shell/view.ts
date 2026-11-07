import { runnableView } from '../../ui/blockView'
import BlockShell from './BlockShell.vue'

/** A shell script and what it printed. */
export const shellView = runnableView(BlockShell, ['src', 'path', 'line', 'onChange'], 'value')
