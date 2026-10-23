import { interpolate, missingValuesError } from '../../domain/values'
import type { BlockRunner } from '../../engine/blockRunner'
import { tookText } from '../../engine/reportText'
import { saveRunsSoon } from '../../engine/runStore'

/**
 * A text by a template (```md template name=…): its {{ values }} filled — the text published under its name, shown
 * as Markdown. A value missing — an error (no text with holes in it).
 */
export const tplRunner: BlockRunner = {
  async run({ env, item }) {
    const t0 = performance.now()
    const r = interpolate(item.body, env.values())
    if (r.missing.length) {
      env.recordRun(item.key, { state: 'error', at: Date.now(), error: missingValuesError(r.missing) })
      saveRunsSoon(env.notePath)
      return false
    }
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
