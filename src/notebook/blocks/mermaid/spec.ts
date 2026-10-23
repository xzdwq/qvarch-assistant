import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, fixedHeight } from '../detectors'
import { mermaidMd, NEW_MERMAID } from './model'

/** A diagram (```mermaid): flowchart, sequence, states, ER, Gantt. */
export const mermaidSpec: BlockSpec<'mermaid'> = {
  kind: 'mermaid',
  title: 'Схема',
  detect: fenceOfLang('mermaid'),
  estimateHeight: fixedHeight(300),
  rawEditable: true,
  commands: [
    {
      id: 'mermaid',
      title: 'Схема',
      hint: 'Блок-схема, последовательность, состояния, ER, Gantt (Mermaid)',
      icon: 'branch',
      keys: ['схема', 'mermaid', 'flowchart', 'диаграмма', 'diagram', 'sequence', 'блок-схема'],
      run: () => ({ kind: 'insertBlock', markdown: mermaidMd(NEW_MERMAID) }),
    },
  ],
}
