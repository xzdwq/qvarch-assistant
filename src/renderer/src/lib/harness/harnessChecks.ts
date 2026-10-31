import { noteRun, runItemNamed, runItemWhereItStands, stopBlockAt, stopLoopAt, syncNoteData, type RunItem } from '@nb/engine'
import { keyNow } from '@nb/engine/runKeys'
import type { CheckResult, HarnessCriterion } from '@shared/agent/harness/model'
import { standingResult } from '@shared/agent/harness/reuse'
import { files } from '../notebook'
import { itemReport, itemText, noteRunsLoaded, noteTextOf } from '../noteRunAccess'

/** The checks going on in a room: the item running (to stop it), whether the rest is to be skipped. */
const going = new Map<string, { path: string; text: string; item?: RunItem; stopped: boolean }>()

/**
 * A run's criteria checked (the ones asked: `ids`): each one's runnable block run where it stands in its note (quietly
 * — the note is not opened, the screen left as it is), one after another; its result (failed — the block's report) and
 * its text now (none — no such block). A block checking several criteria runs once. Not `fresh` — a block passed
 * already and as it was then is not run again; with values doubted (`recheck`) — every block runs, those values anew
 * and the rest as remembered (a block keeps the results of the values whose inputs did not change).
 */
export async function runHarnessChecks(
  room: string,
  criteria: readonly HarnessCriterion[],
  ask: { ids: readonly number[]; fresh: boolean; recheck?: readonly string[] },
): Promise<{ results: Map<number, CheckResult>; bodies: Map<number, string | undefined> }> {
  const results = new Map<number, CheckResult>()
  const bodies = new Map<number, string | undefined>()
  const g = { path: '', text: '', stopped: false } as { path: string; text: string; item?: RunItem; stopped: boolean }
  going.set(room, g)
  /** The blocks run in this pass: one block checks several criteria — it runs once, its result is each one's. */
  const ran = new Map<string, { result: CheckResult; body: string }>()
  try {
    for (const c of criteria) {
      if (!c.check || g.stopped || !ask.ids.includes(c.id)) continue
      const { path, block } = c.check
      const key = `${path}\n${block}`
      const done = ran.get(key)
      if (done) {
        bodies.set(c.id, done.body)
        results.set(c.id, done.result)
        continue
      }
      const fail = (error: string, missing = false) => results.set(c.id, { ok: false, at: Date.now(), error, ...(missing ? { missing } : {}) })
      if (!files.value.includes(path)) {
        bodies.set(c.id, undefined)
        fail(`Заметки «${path}» нет`, true)
        continue
      }
      const text = await noteTextOf(path)
      await noteRunsLoaded(path)
      syncNoteData(path, text)
      const item = runItemNamed(text, block)
      if (!item) {
        bodies.set(c.id, undefined)
        fail(`В заметке «${path}» нет исполняемого блока или цикла «${block}» (name=…)`, true)
        continue
      }
      const body = itemText(text, item)
      bodies.set(c.id, body)
      // (the block passed — for this criterion or another one on it — and is as it was then: its result stands, a long
      // check is not run again for nothing)
      const standing = standingResult(c, criteria, body, ask.fresh || !!ask.recheck?.length)
      if (standing) {
        results.set(c.id, standing)
        continue
      }
      Object.assign(g, { path, text, item })
      const ok = await runItemWhereItStands(path, text, item, { by: 'ai', at: Date.now() }, ask.recheck ? [...ask.recheck] : undefined).catch(() => false)
      const found = ok || g.stopped ? undefined : findingsOf(path, item)
      if (ok) results.set(c.id, { ok: true, at: Date.now() })
      // (it ran through and its ready checks found the thing tested wrong: what they found, not the run's report)
      else if (found) results.set(c.id, { ok: false, at: Date.now(), error: found, findings: true })
      else fail(g.stopped ? 'Остановлено' : itemReport(path, item))
      ran.set(key, { result: results.get(c.id)!, body })
    }
  } finally {
    if (going.get(room) === g) going.delete(room)
  }
  return { results, bodies }
}

/**
 * What a block's ready checks found when the run failed on them, not on itself (its error is a check's verdict — the
 * scenario went through): their failed verdicts in a line each; else none (the test itself broke).
 */
function findingsOf(path: string, item: RunItem): string | undefined {
  if (item.kind === 'loop') return undefined
  const r = noteRun(path).runs[keyNow(path, item.key)]
  if (!r?.error || !/^Проверка «/.test(r.error) || !r.checks?.length) return undefined
  const bad = r.checks.filter((c) => c.state === 'fail')
  return (bad.length ? bad : r.checks).map((c) => `Проверка «${c.name}»: ${c.summary}`).join('\n')
}

/** The room's checks stopped: the block running stopped, the rest not run. */
export function stopHarnessChecks(room: string): void {
  const g = going.get(room)
  if (!g) return
  g.stopped = true
  const x = g.item
  if (!x) return
  if (x.kind === 'loop') stopLoopAt(g.path, g.text, x.line, x.key)
  else stopBlockAt(g.path, g.text, { kind: x.kind, info: x.info, line: x.line })
}
