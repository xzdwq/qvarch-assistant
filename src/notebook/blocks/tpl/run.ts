import { cronMark, type RunTrigger } from '../../../shared/cronJobs'
import { interpolate, missingValuesError } from '../../domain/values'
import { TRIGGER_NAME } from '../../domain/blockInfo'
import type { BlockRunner } from '../../engine/blockRunner'
import { tookText } from '../../engine/reportText'
import { saveRunsSoon } from '../../engine/runStore'
import { chatSend } from '../../engine/chatSend'
import { chatRoomsIn } from '../chat/model'

/** The filled text sent into the note's chat (a scheduled run's message — marked as such); what went wrong, if it did. */
function sendToChat(text: string, noteText: string, trigger: RunTrigger | undefined): string | undefined {
  const room = chatRoomsIn(noteText)[0]
  if (!room) return 'В документе нет чата — добавьте компонент «Чат» (@чат), сюда уйдёт текст'
  const send = chatSend()
  if (!send) return 'Чаты недоступны в этом окне'
  const mark = cronMark(trigger)
  return send(room, mark ? `${text}\n\n_${mark}_` : text) ? undefined : 'Текст не отправлен: пустой или слишком длинный для сообщения'
}

/**
 * A text by a template (```md template name=…): its {{ values }} filled — the text published under its name, shown
 * as Markdown; `chat` — sent into the note's chat too (an `@ИИ · …` in it calls that AI). A value missing — an error
 * (no text with holes in it).
 */
export const tplRunner: BlockRunner = {
  async run({ env, item, noteText }) {
    const t0 = performance.now()
    const values = env.values()
    const r = interpolate(item.body, values)
    const fail = (error: string) => {
      env.recordRun(item.key, { state: 'error', at: Date.now(), error })
      saveRunsSoon(env.notePath)
      return false
    }
    if (r.missing.length) return fail(missingValuesError(r.missing))
    const unsent = item.info.chat ? sendToChat(r.text, noteText, values[TRIGGER_NAME] as RunTrigger | undefined) : undefined
    if (unsent) return fail(unsent)
    env.recordRun(item.key, { state: 'ok', at: Date.now(), ms: performance.now() - t0, value: r.text, hasValue: true })
    if (item.info.name) env.publish(item.info.name, r.text, 'tpl', item.key)
    saveRunsSoon(env.notePath)
    return true
  },
  // (filled at once: nothing to stop)
  stop: () => undefined,
  resultOf: (run) => (run.hasValue ? run.value : undefined),
  reportHeadline: (r) => `${r.state === 'ok' ? 'выполнен' : 'ошибка'}${tookText(r.ms)}`,
}
