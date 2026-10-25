import type { JiraIssue } from '../jira'
import { parseNoteLink } from '../noteEvents'
import type { AttrChip } from '../tracker/attributes'

/**
 * What a shared note's task and event links show to everyone: a snapshot of the task (its description too) or of the
 * event, put into the shared document by a member who has it (their Jira, their timeline). The others — without the
 * task in their Jira or the event on their timeline — see the snapshot; one who has it sees their own, fresher.
 */

/** A Jira task as everyone sees it (the fields of the task's card; the description cut to a size). */
export type RefIssue = Omit<JiraIssue, 'mine' | 'priorityId' | 'estimateSec' | 'spentSec'>
/** An event of someone's timeline as everyone sees it. */
export interface RefEvent {
  day: string
  label: string
  start: number
  end: number
  /** Its kind as its owner has it (the label, the colour, the icon). */
  kind: { label: string; color: string; icon: string }
  outlook: boolean
  description?: string
  task?: { key: string; summary: string }
  attrs?: AttrChip[]
}
/** What a snapshot holds, by the link's kind (written by whoever has the thing). */
export type RefBody = { kind: 'jira'; issue: RefIssue; url?: string } | { kind: 'event'; event: RefEvent }
/** A snapshot as the document keeps it: who put it in and when (the server's clock). */
export type RefCard = RefBody & { by: string; at: number }

/** A description longer than this is cut (the snapshot stays light; the whole one is in Jira). */
export const REF_TEXT_MAX = 20_000
const cut = (s: string | undefined): string | undefined => (s && s.length > REF_TEXT_MAX ? `${s.slice(0, REF_TEXT_MAX)}\n\n…(обрезано)` : s)

/** A task's snapshot: its fields, its address in Jira (when the writer knows the site). */
export function jiraBody(i: JiraIssue, site?: string): RefBody {
  const { mine: _mine, priorityId: _p, estimateSec: _e, spentSec: _s, ...issue } = i
  return { kind: 'jira', issue: { ...issue, description: cut(issue.description) }, ...(site ? { url: `${site.replace(/\/$/, '')}/browse/${i.key}` } : {}) }
}
/** An event's snapshot. */
export function eventBody(e: RefEvent): RefBody {
  return { kind: 'event', event: { ...e, description: cut(e.description) } }
}

/** A value as text with its keys in order (two snapshots compared — whatever order their fields came in). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}
/** The same thing shown (who wrote it and when — not counted). */
export function sameBody(a: RefBody, b: RefBody): boolean {
  const strip = (x: RefBody) => {
    const { by: _by, at: _at, ...rest } = x as RefCard
    return rest
  }
  return canon(strip(a)) === canon(strip(b))
}

/** A snapshot read from the document (anyone may have written it: checked). */
export function isRefCard(x: unknown): x is RefCard {
  const c = x as RefCard
  if (!c || typeof c !== 'object' || typeof c.by !== 'string' || typeof c.at !== 'number') return false
  switch (c.kind) {
    case 'jira':
      return !!c.issue && typeof c.issue.key === 'string' && typeof c.issue.summary === 'string' && typeof c.issue.status === 'string'
    case 'event':
      return !!c.event && typeof c.event.label === 'string' && typeof c.event.start === 'number' && typeof c.event.end === 'number' && !!c.event.kind
    default:
      return false
  }
}

/** The task and event links of a note's text (`[…](qvarch://jira/KEY)`, `[…](qvarch://event/day/id)`), each once. */
export function refUrlsIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\]\((qvarch:\/\/[^)\s]+)\)/g)) if (parseNoteLink(m[1])) out.add(m[1])
  return [...out]
}

/**
 * What to change in a document's snapshots: each link's fresh body (this person has the thing) put in when it differs
 * from the kept one — a task only when this person's copy is not older than the kept one (two members with Jira never
 * overwrite each other back and forth); the snapshots of links no longer in the text — taken out. A link this person
 * knows nothing of keeps the snapshot someone else wrote.
 */
export function refChanges(urls: readonly string[], kept: ReadonlyMap<string, RefCard>, fresh: (url: string) => RefBody | undefined): { put: Array<[string, RefBody]>; drop: string[] } {
  const put: Array<[string, RefBody]> = []
  for (const url of urls) {
    const body = fresh(url)
    if (!body) continue
    const had = kept.get(url)
    if (had && sameBody(had, body)) continue
    if (had?.kind === 'jira' && body.kind === 'jira' && body.issue.updated < had.issue.updated) continue
    put.push([url, body])
  }
  const wanted = new Set(urls)
  return { put, drop: [...kept.keys()].filter((u) => !wanted.has(u)) }
}
