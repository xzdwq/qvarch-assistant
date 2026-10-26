import type { VaultNode } from '../vault'

/**
 * The notebook tree's sharing badges: on a shared note or board — the people it is shared with; on a folder — the
 * people of everything shared in it, each counted once (one person in five documents is one), and whether the folder
 * is shared whole (it, or a folder above it, is a space) or only some of its documents are.
 */
export interface ShareBadge {
  /** The others (not this device) it is shared with — known when the space's members are known. */
  people: number
  /** The folder is shared whole (a note — always: it is its document). */
  whole: boolean
}

export interface SharingFacts {
  /** This device (not counted). */
  me: string
  /** A file's shared document (its live text's mark when open). */
  docOf(n: VaultNode): string | undefined
  /** The space of a document (unknown — undefined: the badge stands, without the people of it). */
  spaceOfDoc(doc: string): string | undefined
  /** A space's members' devices (not known yet — undefined). */
  membersOf(space: string): readonly string[] | undefined
}

/** Each shared node's badge, by path (a folder within a shared one — shared whole, with its people). */
export function shareBadges(nodes: readonly VaultNode[], f: SharingFacts): Map<string, ShareBadge> {
  const out = new Map<string, ShareBadge>()
  const others = (space: string | undefined, into: Set<string>) => {
    for (const id of (space && f.membersOf(space)) || []) if (id !== f.me) into.add(id)
  }
  /** A node's people and whether anything of it is shared; badges put on the way. */
  /** `above` — the people of the shared folder it is in (a folder within it is shared with them too). */
  const walk = (n: VaultNode, above: ReadonlySet<string> | undefined): { people: Set<string>; shared: boolean } => {
    const people = new Set<string>()
    if (!n.dir) {
      const doc = f.docOf(n)
      if (!doc) return { people, shared: false }
      // (a document of a shared folder: its space is the folder's — known by the space's list of documents)
      others(f.spaceOfDoc(doc), people)
      out.set(n.path, { people: people.size, whole: true })
      return { people, shared: true }
    }
    for (const id of above ?? []) people.add(id)
    others(n.space, people)
    const whole = !!above || !!n.space
    const inside = whole ? new Set(people) : undefined
    let shared = whole
    for (const c of n.children ?? []) {
      const r = walk(c, inside)
      for (const id of r.people) people.add(id)
      shared ||= r.shared
    }
    if (shared) out.set(n.path, { people: people.size, whole })
    return { people, shared }
  }
  for (const n of nodes) walk(n, undefined)
  return out
}
