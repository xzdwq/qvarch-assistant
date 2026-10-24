import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, fixedHeight } from '../detectors'

/** A board of the notebook drawn on right in the note (```board); «@доска» opens the list of boards. */
export const boardSpec: BlockSpec<'board'> = {
  kind: 'board',
  title: 'Доска',
  detect: fenceOfLang('board'),
  estimateHeight: fixedHeight(560),
  rawEditable: true,
  commands: [
    {
      id: 'board',
      title: 'Доска',
      hint: 'Доска из блокнота прямо в заметке — рисуйте здесь (и ручкой планшета); «Снимок» — картинкой',
      icon: 'presentation',
      keys: ['доска', 'board', 'whiteboard', 'рисунок', 'холст', 'canvas'],
      run: (c) => ({ kind: 'insertText', text: c.latin ? '@board ' : '@доска ', keepMenu: true }),
    },
  ],
}
