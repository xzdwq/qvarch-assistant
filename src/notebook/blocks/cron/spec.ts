import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, heightPerLine } from '../detectors'

/** An empty ```cron fence: the schedules of the notes. */
export const CRON_MD = '```cron\n```'

/** The notes' schedules: one made for this note, every one listed with its last run. */
export const cronSpec: BlockSpec<'cron'> = {
  kind: 'cron',
  title: 'Расписания',
  detect: fenceOfLang('cron'),
  estimateHeight: heightPerLine(180, 26),
  rawEditable: true,
  commands: [
    {
      id: 'cron',
      title: 'Расписание (cron)',
      hint: 'Выполнять документ по расписанию; список всех расписаний и их последних запусков',
      icon: 'clock',
      keys: ['cron', 'крон', 'расписание', 'schedule', 'таймер', 'по времени', 'каждый день'],
      run: () => ({ kind: 'insertBlock', markdown: CRON_MD }),
    },
  ],
}
