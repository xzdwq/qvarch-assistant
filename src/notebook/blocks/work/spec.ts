import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, heightPerLine } from '../detectors'
import { WORK_PERIODS, WORK_VIEWS, workMd } from './model'

/** The work done over a day or a period, by days, with totals (```work). */
export const workSpec: BlockSpec<'work'> = {
  kind: 'work',
  title: 'Работа',
  detect: fenceOfLang('work'),
  estimateHeight: heightPerLine(40, 24),
  rawEditable: true,
  guide: [
    'Итоги и аналитика работы владельца из «Моей работы» за период: по дням, по видам, всего. Для вопросов «сколько / что я делал за неделю» — этот компонент, а не своя таблица (свои выводы — текстом рядом).',
    `period: ${WORK_PERIODS.map((p) => `${p.id} (${p.title.toLowerCase()})`).join(', ')}; для custom — from: YYYY-MM-DD и to: YYYY-MM-DD.`,
    `view: ${WORK_VIEWS.join(' | ')}; hide: виды через запятую, которые не показывать. Два периода — два блока.`,
  ].join('\n'),
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
