import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, fixedHeight } from '../detectors'
import { chartMd, NEW_CHART } from './model'

/** A chart drawn from its own table of data (```chart). */
export const chartSpec: BlockSpec<'chart'> = {
  kind: 'chart',
  title: 'График',
  detect: fenceOfLang('chart'),
  estimateHeight: fixedHeight(400),
  rawEditable: true,
  commands: [
    {
      id: 'chart',
      title: 'График',
      hint: 'Столбцы, линии, области или круговая — по своей таблице данных',
      icon: 'chart',
      keys: ['график', 'диаграмма', 'chart', 'graph', 'plot'],
      run: () => ({ kind: 'insertBlock', markdown: chartMd(structuredClone(NEW_CHART)) }),
    },
  ],
}
