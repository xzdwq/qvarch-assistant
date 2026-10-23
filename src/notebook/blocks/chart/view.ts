import type { BlockView } from '../../ui/blockView'
import BlockChart from './BlockChart.vue'

/** A chart and its data table. */
export const chartView: BlockView = { component: BlockChart, props: ['src', 'autofocus', 'onChange'] }
