import type { RunState } from './runTypes'

/** Small text helpers of the run reports (a chat, a Jira comment, an e-mail). */

/** A block run's state in a report's words (when it has nothing more to say: no rows, no answer). */
export const RUN_STATE_TEXT: Record<RunState, string> = { run: 'выполняется', ok: 'выполнен', error: 'ошибка' }

/** A duration as people read it: «820 мс», «1.5 с». */
export const durationText = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`)
/** « за 820 мс» — or nothing when the time is unknown. */
export const tookText = (ms?: number) => (ms !== undefined ? ` за ${durationText(ms)}` : '')
/** A moment as a date and a time. */
export const momentText = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** A text cut at n characters («…»). */
export const cutText = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)
/** A text's lines indented (empty ones stay empty). */
export const indentText = (t: string, pad = '  ') =>
  t
    .split('\n')
    .map((l) => (l.trim() ? pad + l : ''))
    .join('\n')
