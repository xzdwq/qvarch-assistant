import type { BlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'
import { findFenceClose } from '../../domain/fence'
import { CALLOUT_FENCE, CALLOUT_START, CALLOUTS, calloutMd } from './model'

/**
 * A coloured callout: `> [!info] …` and the `>` lines after it; or a fence ```callout info … ``` (as other tools write
 * it — looked at before the fences are, or it would be plain code). Changed here — written back as `>` lines.
 */
export const calloutSpec: BlockSpec<'callout'> = {
  kind: 'callout',
  title: 'Выноска',
  detect: {
    by: 'lines',
    order: 20,
    match(lines, i) {
      const fence = CALLOUT_FENCE.exec(lines[i])
      if (fence) {
        const close = findFenceClose(lines, i + 1, fence[1])
        return close < lines.length ? close : undefined
      }
      if (!CALLOUT_START.test(lines[i])) return undefined
      let j = i + 1
      while (j < lines.length && /^>/.test(lines[j])) j++
      return j - 1
    },
  },
  estimateHeight: heightPerLine(40, 24),
  rawEditable: true,
  guide: `Выделенный блок: первая строка > [!вид] Заголовок, дальше строки > текст. Вид: ${CALLOUTS.map((c) => `${c.id} (${c.title.toLowerCase()})`).join(', ')}.`,
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
