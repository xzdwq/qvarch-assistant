import type { ConflictCause, PlanItem } from './release'

/**
 * How the "Релиз" section reads the plan: formatting, the summary of the chronology, the manual cherry-pick
 * commands, conflict hints, ticking a Jira release's branches. Pure — kept in shared so its tests typecheck.
 */

/** The short form of a sha. */
export const shortSha = (sha: string): string => sha.slice(0, 8)

/** dd.mm.yyyy hh:mm:ss in local time; an unparsable value as is, nothing as ''. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 999 → "999", 1500 → "1.5k", 12345 → "12k". */
export const compactCount = (n: number): string =>
  n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n / 1000) + 'k'

/** A branch is a task's when its name holds the key as a whole word: feature/ABC-12, ABC-12-fix — not ABC-123. */
export const taskKeyPattern = (key: string): RegExp => new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`, 'i')

/** Adds the branches of the tasks to the selection; `found` — how many keys got a branch. */
export function tickTaskBranches(branches: Array<{ name: string; ref: string }>, keys: string[], selected: Set<string>): { selected: Set<string>; found: number } {
  const patterns = keys.map(taskKeyPattern)
  const next = new Set(selected)
  const found = new Set<string>()
  for (const b of branches)
    keys.forEach((k, i) => {
      if (patterns[i].test(b.name)) {
        next.add(b.ref)
        found.add(k)
      }
    })
  return { selected: next, found: found.size }
}

/** The text under the Jira release picker after ticking. */
export const taskTickInfo = (keys: number, found: number): string => `задач ${keys} · веток отмечено ${found}${keys - found ? ` · без ветки ${keys - found}` : ''}`

/** An IPC error without Electron's "Error invoking remote method" prefix. */
export { remoteError as ipcErrorText } from './remoteError'

export interface ChronologySummary {
  commits: number
  branches: number
  authors: number
  ins: number
  del: number
  files: number
  conflicts: number
  conditional: number
}

/** Totals of the included items. */
export function summarizeChronology(included: PlanItem[]): ChronologySummary {
  return {
    commits: included.length,
    branches: new Set(included.map((i) => i.branch)).size,
    authors: new Set(included.map((i) => i.authorName)).size,
    ins: included.reduce((s, i) => s + (i.insertions || 0), 0),
    del: included.reduce((s, i) => s + (i.deletions || 0), 0),
    files: new Set(included.flatMap((i) => i.files ?? [])).size,
    conflicts: included.filter((i) => i.dryRunStatus === 'conflict').length,
    conditional: included.filter((i) => i.dryRunStatus === 'conditional').length,
  }
}

/** Whether the plan's branches are exactly the selected ones. */
export function planMatchesSelection(planBranches: string[], selectedNames: string[]): boolean {
  const a = new Set(planBranches)
  const b = new Set(selectedNames)
  return a.size === b.size && [...a].every((x) => b.has(x))
}

/** The pending items as `git cherry-pick` commands, each ending at a conflict or an unchecked commit. */
export function cherryPickSegments(pending: PlanItem[]): PlanItem[][] {
  const out: PlanItem[][] = []
  let cur: PlanItem[] = []
  for (const it of pending) {
    cur.push(it)
    if (it.dryRunStatus === 'conflict' || it.dryRunStatus === 'conditional') {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length) out.push(cur)
  return out
}

/** A command's identity (its shas). */
export const segmentKey = (seg: PlanItem[]): string => seg.map((i) => i.sha).join(',')

/** The possible causes of an item's conflicts, one per branch. */
export function uniqueConflictCauses(item: PlanItem): ConflictCause[] {
  const seen = new Set<string>()
  return (item.dryRunConflictSources ?? []).flatMap((s) => s.possibleCauses ?? []).filter((c) => (seen.has(c.branch) ? false : (seen.add(c.branch), true)))
}

/** Its conflict explanation is still being computed. */
export const conflictAnalysisPending = (item: PlanItem): boolean => (item.dryRunConflictSources ?? [])[0]?.analysisPending === true

/** Earlier conflicting items touching the files an unchecked item depends on. */
export function conflictBlockers(item: PlanItem, items: PlanItem[]): PlanItem[] {
  const files = new Set(item.dryRunConflictFiles ?? [])
  const out: PlanItem[] = []
  for (const o of items) {
    if (o === item) break
    if (o.dryRunStatus === 'conflict' && (o.files ?? []).some((f) => files.has(f))) out.push(o)
  }
  return out
}

/** The branches an item overlaps with, or how many commits when they are unknown. */
export function overlapBranchNames(item: PlanItem, shaToBranch: Map<string, string>): string {
  const names = [...new Set((item.overlapsWith ?? []).map((s) => shaToBranch.get(s)).filter(Boolean))]
  return names.length ? names.join(', ') : `${item.overlapsWith.length} коммит(ами) на других ветках`
}
