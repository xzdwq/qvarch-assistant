import type { RunnableBlockView } from '../../ui/blockView'
import BlockSave from './BlockSave.vue'

/** A variable kept as a file each run: its settings, its last file. */
export const saveView: RunnableBlockView = { component: BlockSave, props: ['src', 'path', 'line', 'onChange'], passResult: 'value' }
