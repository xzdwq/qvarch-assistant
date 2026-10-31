/**
 * Text typed and not used yet (a message not sent, a search, a task's title) kept by its place: a screen shown
 * again — after another section, another note — finds it as it was left. Searches live while the app does; long
 * texts one writes (a message, a question to the AI, a comment) — on the disk too, for a while.
 */

/** A draft: its text, when it was last typed, whether it outlives the app's closing. */
export interface Draft {
  v: string
  at: number
  keep: boolean
}
export const DRAFT_LIMITS = {
  /** Longer than this — kept while the app runs, not on the disk. */
  maxChars: 50_000,
  /** The kept ones on the disk at most (the newest). */
  maxKept: 200,
  /** Older than this — forgotten. */
  maxAgeDays: 30,
} as const
const DAY = 86_400_000

const fresh = (d: Draft, now: number) => now - d.at <= DRAFT_LIMITS.maxAgeDays * DAY

/** The drafts to write to the disk: the kept ones, fresh, not too long — the newest, so many at most. */
export function draftsToKeep(all: Readonly<Record<string, Draft>>, now: number): Record<string, Draft> {
  const list = Object.entries(all)
    .filter(([, d]) => d.keep && d.v && d.v.length <= DRAFT_LIMITS.maxChars && fresh(d, now))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, DRAFT_LIMITS.maxKept)
  return Object.fromEntries(list)
}

/** The drafts read back from the disk: only well-formed, fresh ones (anything else — as if none). */
export function draftsFromDisk(raw: unknown, now: number): Record<string, Draft> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Draft> = {}
  for (const [k, d] of Object.entries(raw as Record<string, unknown>)) {
    const x = d as Partial<Draft> | null
    if (!x || typeof x.v !== 'string' || !x.v || typeof x.at !== 'number' || x.v.length > DRAFT_LIMITS.maxChars) continue
    const draft = { v: x.v, at: x.at, keep: true }
    if (fresh(draft, now)) out[k] = draft
  }
  return out
}
