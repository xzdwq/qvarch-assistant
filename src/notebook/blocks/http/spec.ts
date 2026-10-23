import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'

/** An HTTP request run from the note (```http / ```rest); its answer published under its name. */
export const httpSpec: RunnableBlockSpec<'http'> = {
  kind: 'http',
  title: 'HTTP-запрос',
  detect: { by: 'fence', matches: ({ info }) => info.lang === 'http' || info.lang === 'rest' },
  estimateHeight: heightPerLine(140, 20),
  runnable: true,
  rawEditable: true,
  commands: [
    {
      id: 'http',
      title: 'HTTP-запрос',
      hint: 'Выполняется здесь; ответ доступен дальше по имени — {{имя.body}}',
      icon: 'api',
      keys: ['http', 'запрос', 'request', 'api', 'rest', 'curl', 'get', 'post'],
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`http name=${c.freeName('resp')}\nGET https://\n\`\`\`` }),
    },
  ],
}
