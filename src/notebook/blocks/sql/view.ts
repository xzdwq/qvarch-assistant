import type { RunnableBlockView } from '../../ui/blockView'
import BlockSql from './BlockSql.vue'

/** A database query: its rows or its plan. */
export const sqlView: RunnableBlockView = { component: BlockSql, props: ['src', 'path', 'line', 'onChange'], passResult: 'rows' }
