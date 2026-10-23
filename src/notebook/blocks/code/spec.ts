import { isCodeLang } from '../../domain/blockInfo'
import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'

/** JS / TS run apart from the app (```js run), or the note's shared functions (```ts lib — never run alone). */
export const codeSpec: RunnableBlockSpec<'code'> = {
  kind: 'code',
  title: 'Код',
  detect: { by: 'fence', matches: ({ info }) => isCodeLang(info.lang) && (info.run || info.lib) && !(info.pw && !info.lib) },
  estimateHeight: heightPerLine(140, 20),
  runnable: true,
  rawEditable: true,
  commands: [
    {
      id: 'js',
      title: 'Код JS / TS',
      hint: 'Выполняется отдельно от приложения; переменные заметки — его переменные, return — результат',
      icon: 'code',
      keys: ['код', 'js', 'ts', 'javascript', 'typescript', 'скрипт', 'script', 'run', 'выполнить', 'функция'],
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`js run name=${c.freeName('result')}\n\n\`\`\`` }),
    },
  ],
}
