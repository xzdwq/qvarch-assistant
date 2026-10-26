import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'

/** A text by a template (```md template name=…): Markdown with {{ values }}, published filled. */
export const tplSpec: RunnableBlockSpec<'tpl'> = {
  kind: 'tpl',
  title: 'Шаблон',
  reportTitle: 'Текст по шаблону',
  detect: { by: 'fence', matches: ({ info }) => (info.lang === 'md' || info.lang === 'markdown') && !!info.template },
  estimateHeight: heightPerLine(140, 20),
  runnable: true,
  chip: 'tpl',
  rawEditable: true,
  commands: [
    {
      id: 'tpl',
      title: 'Текст по шаблону',
      hint: 'Markdown с {{ значениями }}: эмодзи, жирный, списки, таблицы — заполняется данными и копируется с оформлением; в цикле — текст на каждый проход',
      icon: 'note',
      keys: ['шаблон', 'template', 'текст', 'text', 'сообщение', 'message', 'markdown', 'отчёт'],
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`md template name=${c.freeName('text')}\n✅ **{{ ${c.newestListName() ?? 'value'} }}**\n\`\`\`` }),
    },
  ],
}
