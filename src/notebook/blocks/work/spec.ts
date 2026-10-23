import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, heightPerLine } from '../detectors'
import { workMd } from './model'

/** The work done over a day or a period, by days, with totals (```work). */
export const workSpec: BlockSpec<'work'> = {
  kind: 'work',
  title: 'Работа',
  detect: fenceOfLang('work'),
  estimateHeight: heightPerLine(40, 24),
  rawEditable: true,
  commands: [
    {
      id: 'work',
      title: 'Работа',
      hint: 'Вся работа за день или период: по дням, итог по видам и всего',
      icon: 'briefcase',
      keys: ['работа', 'work', 'отчёт', 'отчет', 'report', 'таймшит', 'timesheet', 'часы', 'hours'],
      run: () => ({ kind: 'insertBlock', markdown: workMd({ period: 'today', view: 'table' }) }),
    },
  ],
}
