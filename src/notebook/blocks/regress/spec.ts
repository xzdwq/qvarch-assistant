import { regressMd } from '../../../shared/regress'
import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, fixedHeight } from '../detectors'

/** «Регрессия»: every Playwright test of a folder run one after another, with the runs' history (```regress). */
export const regressSpec: BlockSpec<'regress'> = {
  kind: 'regress',
  title: 'Регрессия',
  detect: fenceOfLang('regress'),
  estimateHeight: fixedHeight(320),
  rawEditable: true,
  commands: [
    {
      id: 'regress',
      title: 'Регрессия',
      hint: 'Прогнать все тесты Playwright папки: таблица результатов, история по датам, запуск на другом адресе',
      icon: 'repeat',
      keys: ['регрессия', 'regression', 'прогон', 'тесты', 'tests', 'suite', 'набор', 'автотесты'],
      run: (c) => ({ kind: 'insertBlock', markdown: regressMd({ id: c.newId(), folder: '', deep: true }) }),
    },
  ],
}
