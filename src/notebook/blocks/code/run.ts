import { isTsLang } from '../../domain/blockInfo'
import type { BlockRunner } from '../../engine/blockRunner'
import { cutText, tookText } from '../../engine/reportText'
import { runApi } from '../../engine/runApi'
import { libsOf, runsSnapshot } from '../../engine/runItems'
import { LatestRuns, processRun, trackedRun } from '../../engine/trackedRun'

/** Code runs going on (run again before the first ended — the first one's answer is dropped). */
const latest = new LatestRuns()

/**
 * A code block run apart from the app (the note's «lib» blocks first): what it returns — published under its name,
 * set('x', v) — published as x, emit('x', part) — x gathered as it goes. Its process is killed by stop and by its
 * time limit.
 */
export const codeRunner: BlockRunner = {
  run({ env, item, noteText }) {
    // (the process is known by the block's slot: run again, the old one is killed)
    return trackedRun(latest, env, item.key, { state: 'run', at: Date.now() }, ({ slot }) =>
      processRun(slot, env, item, 'code', () =>
        runApi().runCode(slot, { code: item.body, ts: isTsLang(item.info.lang), libs: libsOf(noteText, item.body), ctx: env.values(), runs: runsSnapshot(env.notePath, noteText, item.key), timeoutSec: item.info.timeout }),
      ),
    )
  },
  stop: (env, key) => runApi().runCodeStop(env.runSlot(key)),
  resultOf: (run) => (run.hasValue ? run.value : undefined),
  reportHeadline: (r) => `${r.state === 'ok' ? 'выполнен' : 'ошибка'}${tookText(r.ms)}`,
  reportDetails: (_r, { body, brief }) => (!brief && !body.includes('\n') && body.trim() ? [`Код: ${cutText(body.trim(), 200)}`] : []),
}
