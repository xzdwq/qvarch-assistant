import type { SpaceDoc } from './space'

/** A shared folder of this computer: its space and where each of its documents was last time (paths in the folder). */
export interface SharedFolderLink {
  /** The folder in the notebook. */
  dir: string
  space: string
  docs: Record<string, string>
}
/** A note in the folder now: its path in the folder, its shared document ('' — not a shared note). */
export interface LocalNote {
  path: string
  doc: string
}

/** One step bringing a shared folder and the server's copy into step. */
export type FolderStep =
  /** The server has a document this folder never had: made here. */
  | { do: 'fetch'; doc: string; path: string }
  /** Someone moved / renamed it: moved here too. */
  | { do: 'moveLocal'; doc: string; from: string; to: string }
  /** Moved / renamed here: told to the server. */
  | { do: 'moveServer'; doc: string; path: string }
  /** Someone deleted it: deleted here (to the recycle bin). */
  | { do: 'deleteLocal'; doc: string; path: string }
  /** Deleted here: deleted for everyone. */
  | { do: 'deleteServer'; doc: string }
  /** A note new here (or a copy of a shared one): added to the space (a mark of another document — replaced). */
  | { do: 'add'; path: string; stale: string }
  /** In step. */
  | { do: 'keep'; doc: string; path: string }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The steps for a shared folder: what changed here since last time goes to the server, what changed there comes
 * here. A path the server and this folder both changed — the server's wins (it is already everyone's).
 */
export function planFolder(server: readonly SpaceDoc[], local: readonly LocalNote[], known: Readonly<Record<string, string>>): FolderStep[] {
  const steps: FolderStep[] = []
  const byDoc = new Map<string, string>()
  const ours = new Set(server.map((d) => d.id))
  for (const n of local) {
    // a note not of this space, or a second copy of one: a new document
    if (!n.doc || !ours.has(n.doc) || byDoc.has(n.doc)) steps.push({ do: 'add', path: n.path, stale: n.doc })
    else byDoc.set(n.doc, n.path)
  }
  for (const d of server) {
    const here = byDoc.get(d.id)
    const was = known[d.id]
    if (d.deleted) {
      if (here) steps.push({ do: 'deleteLocal', doc: d.id, path: here })
      continue
    }
    if (!here) {
      steps.push(was ? { do: 'deleteServer', doc: d.id } : { do: 'fetch', doc: d.id, path: d.path })
      continue
    }
    if (same(here, d.path)) steps.push({ do: 'keep', doc: d.id, path: d.path })
    else if (was && same(was, d.path)) steps.push({ do: 'moveServer', doc: d.id, path: here })
    else steps.push({ do: 'moveLocal', doc: d.id, from: here, to: d.path })
  }
  return steps
}

/**
 * So many of a folder's documents «deleted here» at once looks like a listing gone wrong (not read yet, the folder
 * moved, a disk hiccup), not like a person's deleting: at least this many, and at least this share of its documents.
 */
export const MASS_DELETE = { atLeast: 3, share: 0.5 } as const
/** The steps with a mass deletion held back: those documents fetched here again instead of deleted for everyone. */
export function guardDeletions(steps: readonly FolderStep[], server: readonly SpaceDoc[]): { steps: FolderStep[]; held: number } {
  const deletes = steps.filter((s) => s.do === 'deleteServer').length
  const alive = server.filter((d) => !d.deleted).length
  if (deletes < MASS_DELETE.atLeast || deletes < alive * MASS_DELETE.share) return { steps: [...steps], held: 0 }
  const pathOf = new Map(server.map((d) => [d.id, d.path]))
  return { steps: steps.map((s) => (s.do === 'deleteServer' ? { do: 'fetch', doc: s.doc, path: pathOf.get(s.doc)! } : s)), held: deletes }
}
