/** A reminder the island shows (as well as the system's notification): what, when, the event it is of. */
export interface IslandNotice {
  id: string
  title: string
  text: string
  /** When it fired (epoch ms). */
  at: number
  /** The event it reminds of: its day and id (a click — opened in the app). */
  day?: string
  entryId?: string
}
/** The reminders the island keeps until seen, at most. */
export const NOTICES_MAX = 20
/** A reminder come: first in the list, the same one again — once; the oldest dropped past the limit. */
export const withNotice = (list: readonly IslandNotice[], n: IslandNotice): IslandNotice[] => [n, ...list.filter((x) => x.id !== n.id)].slice(0, NOTICES_MAX)
