import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'

/** A read-only database query (```sql db=<connection>); plain ```sql is code to read. */
export const sqlSpec: RunnableBlockSpec<'sql'> = {
  kind: 'sql',
  title: 'Запрос к БД',
  detect: { by: 'fence', matches: ({ info }) => info.lang === 'sql' && info.db !== undefined },
  estimateHeight: heightPerLine(140, 20),
  runnable: true,
  rawEditable: true,
  commands: [
    {
      id: 'sql',
      title: 'Запрос к БД',
      hint: 'SQL к PostgreSQL / MySQL / SQLite: только чтение, соединение на каждый запрос; строки — в переменную блока, план запроса с узкими местами; запросы всего блокнота — библиотекой',
      icon: 'database',
      keys: ['бд', 'db', 'sql', 'база', 'база данных', 'запрос', 'select', 'postgres', 'postgresql', 'mysql', 'sqlite', 'explain', 'план'],
      // the first connection there is (none yet — chosen in the block); no title line (one is written only when the person names the query)
      run: (c) => ({ kind: 'insertBlock', markdown: ['```sql db=' + c.firstDbConnection() + ' name=' + c.freeName('rows'), 'select ', '```'].join('\n') }),
    },
  ],
}
