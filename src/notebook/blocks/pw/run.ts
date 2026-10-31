import type { PwTarget } from '../../../shared/api'
import type { RunTrigger } from '../../../shared/cronJobs'
import { parseBrowserBody } from '../../../shared/noteBrowser'
import { isTsLang, PW_OWN_BROWSER, TRIGGER_NAME } from '../../domain/blockInfo'
import { fencedBlocksOf } from '../../domain/noteBlocks'
import { noteBrowserPage } from '../../engine/noteBrowsers'
import type { BlockRunner } from '../../engine/blockRunner'
import { tookText } from '../../engine/reportText'
import { errorText, runApi } from '../../engine/runApi'
import type { RunEnv } from '../../engine/runEnv'
import { libsOf, runsSnapshot } from '../../engine/runItems'
import { loadedNoteRun, saveRunsSoon } from '../../engine/runStore'
import { followEmits } from '../../engine/runEmits'
import { checkLines, stepLines } from './modelReport'

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
    const r = own ? own.env.runs[own.env.keyNow(own.key)] : loadedNoteRun(runId.slice(0, i))?.runs[runId.slice(i + 1)]
    if (r?.state === 'run') r.steps = steps
  })
}

/**
 * The page of the app's own browser a block runs in: the note's browser it names — run in a page of its own, from
 * where the browser shows now (on the screen) or from its block's address; else the Браузер's.
 */
function ownTarget(note: string, noteText: string, name?: string): PwTarget {
  if (!name) return { kind: 'section' }
  const block = fencedBlocksOf(noteText).find((b) => b.kind === 'browser' && b.info.name === name)
  if (!block) throw new Error(`В заметке нет браузера «${name}» (in=${name} в строке блока)`)
  const b = parseBrowserBody(block.body)
  const wc = noteBrowserPage(note, name)
  return { kind: 'note', note, name, url: b.tabs[b.active], ...(wc !== undefined ? { wc } : {}) }
}
/** The run was not started by hand (the AI, the harness, a schedule): the screen is left as it is. */
const quietRun = (env: RunEnv) => ((env.values()[TRIGGER_NAME] as RunTrigger | undefined)?.by ?? 'hand') !== 'hand'

/**
 * A Playwright block: the installed browser driven in a process of its own (or a page of the app's own lent to it); its return value and set() published,
 * emit() gathered as it goes.
 * (One at a time per block — its files are the block's: a loop with one goes pass by pass.)
 */
export const pwRunner: BlockRunner = {
  async run({ env, item, noteText, recheck }) {
    listenToProgress()
    const { info, body: code, key } = item
    const runId = env.runSlot(key)
    const own = { env, key }
    // (what its run before gave — a matrix keeps the values whose inputs did not change)
    const before = env.runs[env.keyNow(key)]?.value
    const memo = Array.isArray(before) ? before : undefined
    running.set(runId, own)
    env.recordRun(key, { state: 'run', at: Date.now(), steps: [] })
    const gather = followEmits(runId, env, 'pw', key, info.keep)
    try {
      const target = info.browser === PW_OWN_BROWSER ? ownTarget(env.notePath, noteText, info.in) : undefined
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
        target,
        quiet: quietRun(env),
        headed: !!info.headed,
        trace: !info.notrace,
        session: !!info.session,
        timeoutSec: info.timeout,
        ...(memo ? { memo } : {}),
        ...(recheck?.length ? { recheck } : {}),
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
  // (sized for reading: a matrix's steps counted, not listed; its rows — a line per value)
  reportDetails(r, { brief }) {
    return [...(r.steps?.length ? ['Шаги:', ...stepLines(r.steps, brief)] : []), ...(r.checks?.length ? ['Готовые проверки:', ...checkLines(r.checks, brief)] : [])]
  },
  reportExtras(r) {
    const extra = [r.browser ? `браузер ${r.browser}` : '', r.files?.includes('trace.zip') ? 'трассировка есть' : '', r.files?.some((x) => x.endsWith('.png')) ? 'скриншот есть' : ''].filter(Boolean)
    return extra.length ? [`(${extra.join(' · ')})`] : []
  },
}
