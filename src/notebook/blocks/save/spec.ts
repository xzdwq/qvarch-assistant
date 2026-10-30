import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { fixedHeight } from '../detectors'
import { saveMd } from './model'

/** «Сохранить в файл» (```save): a variable kept as a file each run, when it changed. */
export const saveSpec: RunnableBlockSpec<'save'> = {
  kind: 'save',
  title: 'Сохранить в файл',
  detect: { by: 'fence', matches: ({ info }) => info.lang === 'save' },
  estimateHeight: fixedHeight(110),
  runnable: true,
  chip: 'file',
  rawEditable: true,
  commands: [
    {
      id: 'save',
      title: 'Сохранить в файл',
      hint: 'Каждый прогон — новый файл с переменной (Excel / CSV / JSON / текст), только если данные изменились',
      icon: 'download',
      keys: ['файл', 'сохранить', 'save', 'export', 'экспорт', 'выгрузка', 'excel', 'xlsx', 'csv', 'json', 'txt'],
      run: (c) => ({ kind: 'insertBlock', markdown: saveMd(c.lastValueName() || '') }),
    },
  ],
}
