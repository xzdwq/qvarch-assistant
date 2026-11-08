import { setRunJournalHost } from '@nb/engine'
import { addDocRun } from '@nb/workspace/docAiStore'
import { useTransport } from './transport'

/**
 * The notes' runs written into their journals («Метаданные» → «Запуски»): who ran which block — the person here by
 * their name, an AI agent by its, a harness check, a schedule.
 */
export function startRunJournal(): void {
  const transport = useTransport()
  setRunJournalHost({
    person: () => transport.value.name || 'Вы',
    record: (notePath, run) => void addDocRun(notePath, run).catch(() => undefined),
  })
}
