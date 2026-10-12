import type { DayData, Link, LinkEnd } from './types'

/**
 * Links between things — a task and the call about it, a note and its block, any pair; also across days
 * (each end then carries its day, and the link is kept in both days' lists).
 * Nothing is linked automatically: the user links (editor, or a drag on the timeline), and unlinks.
 * A link has no direction; a pair is linked at most once.
 */
export const sameEnd = (a: LinkEnd, b: LinkEnd): boolean => a.type === b.type && a.id === b.id
export const endKey = (e: LinkEnd): string => `${e.type}:${e.id}`
const samePair = (l: Link, a: LinkEnd, b: LinkEnd) => (sameEnd(l.a, a) && sameEnd(l.b, b)) || (sameEnd(l.a, b) && sameEnd(l.b, a))

export function exists(d: Pick<DayData, 'day' | 'entries' | 'notes'>, e: LinkEnd): boolean {
  // an end on another day is checked there (the app removes such links when that thing goes)
  if (e.day && e.day !== d.day) return true
  return e.type === 'entry' ? d.entries.some((x) => x.id === e.id) : d.notes.some((x) => x.id === e.id)
}

/** Adds a link (no self-links, no duplicates). */
export function addLink(links: Link[], a: LinkEnd, b: LinkEnd, id: string, at: number): Link[] {
  if (sameEnd(a, b) || links.some((l) => samePair(l, a, b))) return links
  const plain = (e: LinkEnd): LinkEnd => ({ type: e.type, id: e.id, ...(e.day ? { day: e.day } : {}), ...(e.hint ? { hint: e.hint } : {}) })
  return [...links, { id, a: plain(a), b: plain(b), at }]
}

/** The other ends linked to `end`. */
export function linkedTo(links: Link[], end: LinkEnd): Array<{ link: Link; other: LinkEnd }> {
  const out: Array<{ link: Link; other: LinkEnd }> = []
  for (const l of links) {
    if (sameEnd(l.a, end)) out.push({ link: l, other: l.b })
    else if (sameEnd(l.b, end)) out.push({ link: l, other: l.a })
  }
  return out
}

/**
 * The links of `end` become exactly `others` (an editor's list of the same day): missing ones are added,
 * the rest dropped. Links across days are not in that list — they stay.
 */
export function setLinksOf(links: Link[], end: LinkEnd, others: LinkEnd[], newId: () => string, at: number): Link[] {
  let out = links.filter((l) => l.a.day || l.b.day || !((sameEnd(l.a, end) && !others.some((o) => sameEnd(o, l.b))) || (sameEnd(l.b, end) && !others.some((o) => sameEnd(o, l.a)))))
  for (const o of others) out = addLink(out, end, o, newId(), at)
  return out
}

/** Links whose ends still exist (after a delete). */
export function pruneLinks(d: Pick<DayData, 'day' | 'entries' | 'notes' | 'links'>): Link[] {
  return (d.links ?? []).filter((l) => exists(d, l.a) && exists(d, l.b))
}

/** The day an end of a link (held in `holder`'s list) lives on. */
export const endDay = (e: LinkEnd, holder: string): string => e.day ?? holder
/** A link whose ends are on two different days. */
export const isCrossDay = (l: Link, holder: string): boolean => endDay(l.a, holder) !== endDay(l.b, holder)

/** Entries merged into one: their links move to the merged block (duplicates and self-links dropped). */
export function remapLinks(links: Link[], removed: string[], into: string): Link[] {
  const map = (e: LinkEnd): LinkEnd => (e.type === 'entry' && removed.includes(e.id) ? { type: 'entry', id: into } : e)
  let out: Link[] = []
  for (const l of links) out = addLink(out, map(l.a), map(l.b), l.id, l.at)
  return out
}
