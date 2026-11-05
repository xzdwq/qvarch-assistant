import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { interpolate } from '../../domain/values'
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
  serialInLoop: false,
  test: false,
  rawEditable: true,
  // (published whenever it can be filled — a text with holes in it never is)
  publishWithoutRun: {
    source: 'tpl',
    usesValues: true,
    valueOf(body, _info, values) {
      const r = interpolate(body, values)
      return r.missing.length ? undefined : { value: r.text }
    },
  },
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
