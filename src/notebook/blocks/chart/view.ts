import { blockView } from '../../ui/blockView'
import BlockChart from './BlockChart.vue'

/** A chart and its data table. */
export const chartView = blockView(BlockChart, ['src', 'autofocus', 'onChange'])
