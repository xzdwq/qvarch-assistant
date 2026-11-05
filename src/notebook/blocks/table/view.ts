import { blockView } from '../../ui/blockView'
import BlockTable from './BlockTable.vue'

/** An editable table (filled from a value of the note when asked). */
export const tableView = blockView(BlockTable, ['src', 'path', 'line', 'autofocus', 'onChange', 'onExit'])
