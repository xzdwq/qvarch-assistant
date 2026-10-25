import { isReaction, REACTIONS } from './chat'

/** How often this person put each reaction (emoji → times), kept on their computer. */
export type ReactionCounts = Record<string, number>
/** The reactions offered first, this many. */
export const QUICK_REACTIONS = REACTIONS.length

/** The reactions offered first: the ones put most (ties — in the usual order), the usual ones filling the rest. */
export function quickReactions(counts: ReactionCounts, n = QUICK_REACTIONS): string[] {
  const usual = REACTIONS as readonly string[]
  const rank = (e: string) => (usual.includes(e) ? usual.indexOf(e) : usual.length)
  const used = Object.entries(counts)
    .filter(([e, c]) => isReaction(e) && c > 0)
    .sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))
    .map(([e]) => e)
  return [...new Set([...used, ...usual])].slice(0, n)
}
/** One more time a reaction was put (the counts kept small: the rarest dropped past `keep`). */
export function countedReaction(counts: ReactionCounts, emoji: string, keep = 64): ReactionCounts {
  if (!isReaction(emoji)) return counts
  const next = { ...counts, [emoji]: (counts[emoji] ?? 0) + 1 }
  const list = Object.entries(next).sort((a, b) => b[1] - a[1])
  return Object.fromEntries(list.slice(0, keep))
}
