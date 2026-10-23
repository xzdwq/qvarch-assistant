import type { BlockSpec } from '../../domain/blockSpec'
import { LOOP_CLOSE_MD, LOOP_MAX, LOOP_TIMEOUT, loopOpenMd, loopStartAt } from '../../domain/loop'
import { heightPerLine } from '../detectors'

/**
 * A loop's start: its comment and the head fence under it (```js loop). The blocks down to its end run once per
 * pass. (It runs as a whole — see the run engine's loop runner — not as a block of a pass.)
 */
export const loopSpec: BlockSpec<'loop'> = {
  kind: 'loop',
  title: 'Цикл',
  detect: {
    by: 'lines',
    order: 10,
    match(lines, i) {
      const start = loopStartAt(lines, i)
      return start ? start.line1 - 1 : undefined
    },
  },
  estimateHeight: heightPerLine(140, 20),
  rawEditable: true,
  commands: [
    {
      id: 'loop',
      title: 'Цикл',
      hint: 'Повторить блоки для каждого элемента: заголовок — обычный JS (for…of, for…in, Object.entries, while), await body({ … }) — проход; результаты — по одному, вместе (одна таблица / один текст) или каждый отдельно',
      icon: 'repeat',
      keys: ['цикл', 'loop', 'for', 'foreach', 'each', 'while', 'повтор', 'перебор', 'итерация', 'каждый'],
      // its head empty: the loop offers its kinds (for…of, a counter, for…in, while…) — the chosen one fills it
      run: (c) => ({ kind: 'insertBlock', markdown: [loopOpenMd({ name: c.freeName('passes'), parallel: 1, max: LOOP_MAX, timeout: LOOP_TIMEOUT }), '```js loop', '', '```', '', LOOP_CLOSE_MD].join('\n') }),
    },
  ],
}
