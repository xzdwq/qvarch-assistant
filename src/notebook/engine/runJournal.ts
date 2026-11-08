import type { SqlMode } from '../../shared/sql'
import type { RunTrigger } from '../../shared/cronJobs'
import { docRunOf, runWhoOf, type DocRun } from '../../shared/agent/docRuns'
import { runnableSpec } from '../blocks/specs'
import type { RunEnv } from './runEnv'
import { runItem } from './runItem'
import { itemError, itemName, type RunItem } from './runItems'
import { takeRunWaited } from './runWaits'

/**
 * Every run asked for — by a person, an AI agent, a harness check, a schedule — goes into the note's journal: who,
 * which block, when, how long, how it ended, whether it waited for a person. The app tells who the person here is and
 * where the journal is kept (the engine knows neither).
 */
export interface RunJournalHost {
  /** The person at this app (a run by hand is theirs). */
  person(): string
  record(notePath: string, run: DocRun): void
}
let host: RunJournalHost | undefined
export const setRunJournalHost = (h: RunJournalHost | undefined): void => void (host = h)

/** An item as a person reads it: its kind's title and its name («Оболочка «logs»»); unnamed — the title only. */
export function itemLabel(item: RunItem): string {
  const title = item.kind === 'loop' ? 'Цикл' : runnableSpec(item.kind).title
  const name = itemName(item)
  return name ? `${title} «${name}»` : title
}

/** An item run as asked (by `trigger`), then written into its note's journal; `all` — a part of «Выполнить всё». */
export async function runJournaled(item: RunItem, env: RunEnv, noteText: string, trigger: RunTrigger, opts: { sqlMode?: SqlMode; recheck?: string[]; all?: boolean } = {}): Promise<boolean> {
  const notePath = env.notePath
  const at = Date.now()
  // (a wait of an earlier run of it is not this one's)
  takeRunWaited(notePath, item.key)
  const ok = await runItem(item, env, noteText, opts)
  const waited = takeRunWaited(notePath, item.key)
  if (host) host.record(notePath, docRunOf({ at, ms: Date.now() - at, who: runWhoOf(trigger, host.person()), block: itemLabel(item), line: item.line, all: opts.all, ok, error: ok ? undefined : itemError(item, env), waited }))
  return ok
}
