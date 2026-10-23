import type { BlockView } from '../../ui/blockView'
import BlockTable from './BlockTable.vue'

/** An editable table (filled from a value of the note when asked). */
export const tableView: BlockView = { component: BlockTable, props: ['src', 'path', 'line', 'autofocus', 'onChange', 'onExit'] }
