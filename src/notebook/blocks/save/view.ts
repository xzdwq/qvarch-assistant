import { runnableView } from '../../ui/blockView'
import BlockSave from './BlockSave.vue'

/** A variable kept as a file each run: its settings, its last file. */
export const saveView = runnableView(BlockSave, ['src', 'path', 'line', 'onChange'], 'value')
