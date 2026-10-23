import type { BlockSpec } from '../../domain/blockSpec'
import { fixedHeight } from '../detectors'

/** A value of the note's context shown live (```json ref=login.body; view=table — as a table). */
export const refSpec: BlockSpec<'ref'> = {
  kind: 'ref',
  title: 'Значение',
  detect: { by: 'fence', matches: ({ info }) => (info.lang === 'json' || info.lang === 'yaml') && !!info.ref },
  estimateHeight: fixedHeight(90),
  rawEditable: true,
  commands: [
    {
      id: 'ref',
      title: 'Значение переменной',
      hint: 'Показывает значение из контекста заметки — вживую',
      icon: 'eye',
      keys: ['значение', 'value', 'ref', 'вывод', 'output', 'показать'],
      run: (c) => ({ kind: 'insertBlock', markdown: '```json ref=' + (c.lastValueName() || 'value') + '\n```' }),
    },
  ],
}
