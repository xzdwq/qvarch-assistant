import type { PwResult, PwTarget } from '../../../shared/api'
import type { RunTrigger } from '../../../shared/cronJobs'
import { parseBrowserBody } from '../../../shared/noteBrowser'
import { isTsLang, PW_OWN_BROWSER, TRIGGER_NAME } from '../../domain/blockInfo'
import { fencedBlocksOf } from '../../domain/noteBlocks'
import { noteBrowserPage } from '../../engine/noteBrowsers'
import type { BlockRunner } from '../../engine/blockRunner'
import { tookText } from '../../engine/reportText'
import { runApi } from '../../engine/runApi'
import type { RunEnv } from '../../engine/runEnv'
import { libsOf, runsSnapshot, type BlockItem } from '../../engine/runItems'
import { loadedNoteRun } from '../../engine/runStore'
import { LatestRuns, processRun, trackedRun } from '../../engine/trackedRun'
import { checkLines, stepLines } from './modelReport'

/** The Playwright runs going on: their run id → where their run is kept (the steps come by it). */
const running = new Map<string, { env: RunEnv; key: string }>()
/** The latest run of each block (run again before the first ended — the first one's answer is dropped). */
const latest = new LatestRuns()
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
  run({ env, item, noteText, recheck }) {
    listenToProgress()
    const key = item.key
    // (what its run before gave — a matrix keeps the values whose inputs did not change)
    const before = env.runs[env.keyNow(key)]?.value
    const memo = Array.isArray(before) ? before : undefined
    // (the process is known by the block's slot: run again, the old one is stopped — «Перезапущено»)
    return trackedRun(latest, env, key, { state: 'run', at: Date.now(), steps: [] }, async ({ slot }) => {
      const own = { env, key }
      running.set(slot, own)
      try {
        return await processRun(slot, env, item, 'pw', () => sendScenario(slot, env, item, noteText, memo, recheck), (r) => ({ steps: r.steps, checks: r.checks, files: r.files, browser: r.browser }))
      } finally {
        if (running.get(slot) === own) running.delete(slot)
      }
    })
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

/** The scenario sent to its process (known by the block's slot); its result. */
function sendScenario(slot: string, env: RunEnv, item: BlockItem, noteText: string, memo: unknown[] | undefined, recheck: string[] | undefined): Promise<PwResult> {
  const { info, body: code, key } = item
  const target = info.browser === PW_OWN_BROWSER ? ownTarget(env.notePath, noteText, info.in) : undefined
  return runApi().runPw(slot, {
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
}
