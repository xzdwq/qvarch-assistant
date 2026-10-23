import { isTsLang } from '../../domain/blockInfo'
import type { BlockRunner } from '../../engine/blockRunner'
import { cutText, tookText } from '../../engine/reportText'
import { errorText, runApi } from '../../engine/runApi'
import { libsOf, runsSnapshot } from '../../engine/runItems'
import { saveRunsSoon } from '../../engine/runStore'

/**
 * A code block run apart from the app (the note's «lib» blocks first): what it returns — published under its name,
 * set('x', v) — published as x. Its process is killed by stop and by its time limit.
 */
export const codeRunner: BlockRunner = {
  async run({ env, item, noteText }) {
    const runId = env.runSlot(item.key)
    env.recordRun(item.key, { state: 'run', at: Date.now() })
    try {
      const r = await runApi().runCode(runId, { code: item.body, ts: isTsLang(item.info.lang), libs: libsOf(noteText, item.body), ctx: env.values(), runs: runsSnapshot(env.notePath, noteText, item.key), timeoutSec: item.info.timeout })
      env.recordRun(item.key, { state: r.ok ? 'ok' : 'error', at: Date.now(), ms: r.ms, logs: r.logs, error: r.error, value: r.value, hasValue: r.hasValue })
      if (r.ok && item.info.name && r.hasValue) env.publish(item.info.name, r.value, 'code', item.key)
      for (const [k, v] of Object.entries(r.sets ?? {})) env.publish(k, v, 'set', item.key)
      saveRunsSoon(env.notePath)
      return r.ok
    } catch (e) {
      env.recordRun(item.key, { state: 'error', at: Date.now(), error: errorText(e) })
      saveRunsSoon(env.notePath)
      return false
    }
  },
  stop: (env, key) => runApi().runCodeStop(env.runSlot(key)),
  resultOf: (run) => (run.hasValue ? run.value : undefined),
  reportHeadline: (r) => `${r.state === 'ok' ? 'выполнен' : 'ошибка'}${tookText(r.ms)}`,
  reportDetails: (_r, { body, brief }) => (!brief && !body.includes('\n') && body.trim() ? [`Код: ${cutText(body.trim(), 200)}`] : []),
}
