import type { BlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'
import { TOGGLE_CLOSE, TOGGLE_OPEN, toggleMd } from './model'

/** A fold: `<details>` … `</details>` (an unclosed one is plain text). */
export const toggleSpec: BlockSpec<'toggle'> = {
  kind: 'toggle',
  title: 'Свёртка',
  detect: {
    by: 'lines',
    order: 70,
    match(lines, i) {
      if (!TOGGLE_OPEN.test(lines[i])) return undefined
      let j = i + 1
      while (j < lines.length && !TOGGLE_CLOSE.test(lines[j])) j++
      return j < lines.length ? j : undefined
    },
  },
  estimateHeight: heightPerLine(40, 24),
  rawEditable: true,
  guide: 'Сворачиваемый раздел: подробности, которые не нужны с первого взгляда (логи, длинные списки).',
  commands: [
    {
      id: 'toggle',
      title: 'Свёртка',
      hint: 'Заголовок, который раскрывает скрытый текст',
      icon: 'chevronRight',
      keys: ['свёртка', 'свертка', 'toggle', 'details', 'раскрывающийся', 'спойлер', 'spoiler', 'collapse'],
      run: () => ({ kind: 'insertBlock', markdown: toggleMd({ title: '', body: '', open: true }) }),
    },
  ],
}
