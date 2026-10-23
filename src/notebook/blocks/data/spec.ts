import type { BlockSpec } from '../../domain/blockSpec'
import { fixedHeight } from '../detectors'

/** Data of the note (```json name=… / ```yaml name=…): published as soon as it parses. */
export const dataSpec: BlockSpec<'data'> = {
  kind: 'data',
  title: 'Данные',
  detect: { by: 'fence', matches: ({ info }) => (info.lang === 'json' || info.lang === 'yaml') && !!info.name && !info.ref },
  estimateHeight: fixedHeight(90),
  rawEditable: true,
  commands: [
    {
      id: 'data',
      title: 'Данные JSON',
      hint: 'Набор данных с именем — для кода и запросов',
      icon: 'braces',
      keys: ['данные', 'data', 'json', 'yaml', 'массив', 'array', 'переменная', 'variable'],
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`json name=${c.freeName('data')}\n[]\n\`\`\`` }),
    },
  ],
}
