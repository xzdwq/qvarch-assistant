import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'

/** A new request block: its name, method and address. */
const httpMd = (name: string, method: string, url: string) => `\`\`\`http name=${name}\n${method} ${url}\n\`\`\``

/** An HTTP request run from the note (```http / ```rest); its answer published under its name. */
export const httpSpec: RunnableBlockSpec<'http'> = {
  kind: 'http',
  title: 'HTTP-запрос',
  detect: { by: 'fence', matches: ({ info }) => info.lang === 'http' || info.lang === 'rest' },
  estimateHeight: heightPerLine(140, 20),
  runnable: true,
  chip: 'http',
  rawEditable: true,
  commands: [
    {
      id: 'http',
      title: 'HTTP-запрос',
      hint: 'Выполняется здесь; ответ доступен дальше по имени — {{имя.body}}',
      icon: 'api',
      keys: ['http', 'запрос', 'request', 'api', 'rest', 'curl', 'get', 'post', 'put', 'patch', 'delete', 'fetch', 'url', 'эндпоинт', 'endpoint'],
      run: (c) => ({ kind: 'insertBlock', markdown: httpMd(c.freeName('resp'), 'GET', 'https://') }),
      // «@get https://…», «@post /api/items» — the request to that address
      withArg: {
        pattern: /^(get|post|put|patch|delete|head|options)\s+(\S+)\s*$/i,
        title: (m) => `HTTP: ${m[1].toUpperCase()} ${m[2]}`,
        run: (c, m) => ({ kind: 'insertBlock', markdown: httpMd(c.freeName('resp'), m[1].toUpperCase(), m[2]) }),
      },
    },
  ],
}
