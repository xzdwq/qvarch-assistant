import type { BlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'
import { CALLOUT_START, calloutMd } from './model'

/** A coloured callout: `> [!info] …` and the `>` lines after it. */
export const calloutSpec: BlockSpec<'callout'> = {
  kind: 'callout',
  title: 'Выноска',
  detect: {
    by: 'lines',
    order: 60,
    match(lines, i) {
      if (!CALLOUT_START.test(lines[i])) return undefined
      let j = i + 1
      while (j < lines.length && /^>/.test(lines[j])) j++
      return j - 1
    },
  },
  estimateHeight: heightPerLine(40, 24),
  rawEditable: true,
  commands: [
    {
      id: 'callout',
      title: 'Выноска',
      hint: 'Цветной блок: информация, совет, внимание, опасно, готово',
      icon: 'bell',
      keys: ['выноска', 'callout', 'внимание', 'совет', 'инфо', 'info', 'warning', 'note', 'tip', 'admonition'],
      run: () => ({ kind: 'insertBlock', markdown: calloutMd({ type: 'info', title: '', body: '' }) }),
    },
  ],
}
