import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, heightPerLine } from '../detectors'

/** An empty ```toc fence: the note's headings drawn as its table of contents. */
export const TOC_MD = '```toc\n```'

/** The note's table of contents (its headings; a click goes to the section). */
export const tocSpec: BlockSpec<'toc'> = {
  kind: 'toc',
  title: 'Оглавление',
  detect: fenceOfLang('toc'),
  estimateHeight: heightPerLine(60, 26),
  rawEditable: true,
  commands: [
    {
      id: 'toc',
      title: 'Оглавление',
      hint: 'Список заголовков заметки — клик ведёт к разделу',
      icon: 'list',
      keys: ['оглавление', 'содержание', 'toc', 'contents'],
      run: () => ({ kind: 'insertBlock', markdown: TOC_MD }),
    },
  ],
}
