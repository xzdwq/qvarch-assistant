import { isTsLang } from '../../domain/blockInfo'
import type { BlockRunner } from '../../engine/blockRunner'
import { cutText, durationText, tookText } from '../../engine/reportText'
import { errorText, runApi } from '../../engine/runApi'
import type { RunEnv } from '../../engine/runEnv'
import { libsOf, runsSnapshot } from '../../engine/runItems'
import { loadedNoteRun, saveRunsSoon } from '../../engine/runStore'
import { followEmits } from '../../engine/runEmits'

/** The Playwright runs going on: their run id → where their run is kept (the steps come by it). */
const running = new Map<string, { env: RunEnv; key: string }>()
let listening = false
/** The steps of the runs going on, as the main process sends them, into their runs. */
function listenToProgress(): void {
  if (listening) return
  listening = true
  runApi().onPwProgress((runId, steps) => {
    const own = running.get(runId)
    const i = runId.lastIndexOf('#')
    const r = own ? own.env.runs[own.key] : loadedNoteRun(runId.slice(0, i))?.runs[runId.slice(i + 1)]
    if (r?.state === 'run') r.steps = steps
  })
}

/**
 * A Playwright block: the installed browser driven in a process of its own; its return value and set() published,
 * emit() gathered as it goes.
 * (One at a time per block — its files are the block's: a loop with one goes pass by pass.)
 */
export const pwRunner: BlockRunner = {
  async run({ env, item, noteText }) {
    listenToProgress()
    const { info, body: code, key } = item
    const runId = env.runSlot(key)
    const own = { env, key }
    running.set(runId, own)
    env.recordRun(key, { state: 'run', at: Date.now(), steps: [] })
    const gather = followEmits(runId, env, 'pw', key, info.keep)
    try {
      const r = await runApi().runPw(runId, {
        code,
        ts: isTsLang(info.lang),
        libs: libsOf(noteText, code),
        ctx: env.values(),
        runs: runsSnapshot(env.notePath, noteText, key),
        note: env.notePath,
        key,
        name: info.name ?? 'Сценарий',
        browser: info.browser ?? 'msedge',
        headed: !!info.headed,
        trace: !info.notrace,
        session: !!info.session,
        timeoutSec: info.timeout,
      })
      const lost = await gather.end(r.emits, r.ok)
      const ok = r.ok && !lost
      env.recordRun(key, { state: ok ? 'ok' : 'error', at: Date.now(), ms: r.ms, logs: r.logs, error: r.error ?? lost, value: r.value, hasValue: r.hasValue, steps: r.steps, checks: r.checks, files: r.files, browser: r.browser })
      if (ok && info.name && r.hasValue) env.publish(info.name, r.value, 'pw', key)
      for (const [k, v] of Object.entries(r.sets ?? {})) env.publish(k, v, 'set', key)
      saveRunsSoon(env.notePath)
      return ok
    } catch (e) {
      await gather.end(undefined, false)
      env.recordRun(key, { state: 'error', at: Date.now(), error: errorText(e) })
      saveRunsSoon(env.notePath)
      return false
    } finally {
      if (running.get(runId) === own) running.delete(runId)
    }
  },
  stop: (env, key) => runApi().runPwStop(env.runSlot(key)),
  resultOf: (run) => (run.hasValue ? run.value : undefined),
  reportHeadline: (r, { info }) => `${r.state === 'ok' ? 'пройден' : r.state === 'run' ? 'выполняется' : info.soft ? 'упал (ожидаемо)' : 'упал'}${tookText(r.ms)}`,
  reportDetails(r, { brief }) {
    if (!r.steps?.length) return []
    const out = ['Шаги:']
    for (const st of r.steps) {
      out.push(`${'  '.repeat(st.depth + 1)}${st.state === 'ok' ? '✅' : st.state === 'run' ? '⏳' : '❌'} ${st.name}${st.ms !== undefined ? ` — ${durationText(st.ms)}` : ''}`)
      if (st.error && !brief) out.push(`${'  '.repeat(st.depth + 2)}${cutText(st.error, 300)}`)
    }
    return out
  },
  reportExtras(r) {
    const extra = [r.browser ? `браузер ${r.browser}` : '', r.files?.includes('trace.zip') ? 'трассировка есть' : '', r.files?.some((x) => x.endsWith('.png')) ? 'скриншот есть' : ''].filter(Boolean)
    return extra.length ? [`(${extra.join(' · ')})`] : []
  },
}
