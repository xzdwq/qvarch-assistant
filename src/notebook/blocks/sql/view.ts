import { runnableView } from '../../ui/blockView'
import BlockSql from './BlockSql.vue'

/** A database query: its rows or its plan. */
export const sqlView = runnableView(BlockSql, ['src', 'path', 'line', 'onChange'], 'rows')
