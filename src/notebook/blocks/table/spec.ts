import type { BlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'
import { isSepRow, isTableRow, TABLE_META } from './model'

/** A GFM table (its settings comment over it belongs to it); «@таблица» opens the size picker. */
export const tableSpec: BlockSpec<'table'> = {
  kind: 'table',
  title: 'Таблица',
  detect: {
    by: 'lines',
    order: 50,
    match(lines, i) {
      const w = TABLE_META.test(lines[i]) ? 1 : 0
      if (!isTableRow(lines[i + w] ?? '') || i + w + 1 >= lines.length || !isSepRow(lines[i + w + 1])) return undefined
      let j = i + w + 2
      while (j < lines.length && isTableRow(lines[j])) j++
      return j - 1
    },
  },
  estimateHeight: heightPerLine(24, 34),
  rawEditable: true,
  guide: 'Обычная таблица Markdown (GFM): | Колонка | Колонка |, под ней | --- | --- |, дальше строки. В ячейках можно ссылки и **выделение**.',
  commands: [
    {
      id: 'table',
      title: 'Таблица',
      hint: 'Таблица — выберите размер',
      icon: 'table',
      keys: ['таблица', 'table', 'grid', 'сетка'],
      run: (c) => ({ kind: 'insertText', text: c.latin ? '@table ' : '@таблица ', keepMenu: true }),
    },
  ],
}
