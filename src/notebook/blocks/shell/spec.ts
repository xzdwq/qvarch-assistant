import { shellKindOf } from '../../../shared/shell/shells'
import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'

/**
 * A script run in a shell (```powershell run / ```cmd run / ```bash run): on this PC, or on a saved SSH session's
 * server (ssh=…); its output — the value under its name (exit code, stdout, lines, matches).
 */
export const shellSpec: RunnableBlockSpec<'shell'> = {
  kind: 'shell',
  title: 'Оболочка',
  detect: { by: 'fence', matches: ({ info }) => !!shellKindOf(info.lang) && info.run },
  estimateHeight: heightPerLine(150, 20),
  runnable: true,
  chip: 'shell',
  serialInLoop: false,
  test: false,
  rawEditable: true,
  commands: [
    {
      id: 'shell',
      title: 'Оболочка — PowerShell / cmd / bash',
      hint: 'Команды на этом ПК или на сервере по SSH; вывод — значение по имени: {{имя.stdout}}, {{имя.lines}}',
      icon: 'terminal',
      keys: ['оболочка', 'shell', 'powershell', 'pwsh', 'cmd', 'bash', 'терминал', 'terminal', 'команда', 'скрипт', 'ssh', 'сервер', 'консоль'],
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`powershell run name=${c.freeName('out')}\n\n\`\`\`` }),
    },
  ],
}
