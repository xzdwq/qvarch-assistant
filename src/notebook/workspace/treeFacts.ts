import { computed } from 'vue'
import type { VaultNode } from '@shared/vault'
import { sharedDocOfFile } from '@shared/transport/sharedFormats'
import { isHomeless, type ChatRoom } from '@shared/transport/chat'
import { chatRoomsIn } from '@nb/blocks/chat/model'
import { shareBadges, type ShareBadge } from '@shared/transport/treeSharing'
import { useTransport } from '@renderer/lib/transport'
import { runChipsOf } from '@nb/domain/noteBlocks'
import { headTags } from '@nb/domain/graph/tags'
import { docs } from './noteDocs'
import { sharedInfo, spaces } from './sharedDocs'
import { tree } from './vaultTreeStore'

/**
 * What the notebook's tree shows of a file beyond its name: its runnable components, whether it is shared and with
 * how many people. The tree read from the disk has them; an open note's live text goes first (an edit made a moment
 * ago, a note just shared — the tree is not read again on one's own saves).
 */

/** The last open text read, and what it gave — read again only when the text changed. */
const live = new Map<string, { text: string; runs: string[]; chats: string[]; tags: string[]; doc: string }>()
function liveOf(path: string): { runs: string[]; chats: string[]; tags: string[]; doc: string } | undefined {
  const d = docs.get(path)
  if (!d?.loaded) return undefined
  const hit = live.get(path)
  if (hit?.text === d.text) return hit
  const note = path.endsWith('.md')
  const got = { text: d.text, runs: note ? runChipsOf(d.text) : [], chats: note ? chatRoomsIn(d.text) : [], tags: note ? headTags(d.text) : [], doc: sharedDocOfFile(path, d.text) }
  live.set(path, got)
  return got
}

/** The rooms one's notes show (none — the tree not read yet: nothing is known). */
export const chatHomes = computed((): ReadonlySet<string> | undefined => {
  if (!tree.value.length) return undefined
  const out = new Set<string>()
  const walk = (ns: readonly VaultNode[]) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : (liveOf(n.path)?.chats ?? n.chats ?? []).forEach((r) => out.add(r))))
  walk(tree.value)
  return out
})
/** A chat in none of one's notes (its note deleted; not known yet — no). */
export const homeless = (r: ChatRoom): boolean => !!chatHomes.value && isHomeless(r, chatHomes.value)

/** A note's runnable components as chips (db, js/ts, http…). */
export const runsOf = (n: VaultNode): string[] => liveOf(n.path)?.runs ?? n.runs ?? []
/** The tags of a note's first line (shown before its components). */
export const headTagsOf = (n: VaultNode): string[] => liveOf(n.path)?.tags ?? n.tags ?? []
const docOf = (n: VaultNode): string | undefined => {
  const l = liveOf(n.path)
  return l ? l.doc || undefined : n.doc
}

/** Each document's space, by the spaces' lists of documents. */
const spaceByDoc = computed(() => {
  const m = new Map<string, string>()
  for (const sp of spaces.values()) for (const d of sp.docs) m.set(d.id, sp.id)
  return m
})

/** Each shared node's badge (the people it is shared with, a folder — shared whole or only in part). */
export const treeBadges = computed((): Map<string, ShareBadge> => {
  const me = useTransport().value.deviceId
  return shareBadges(tree.value, {
    me,
    docOf,
    spaceOfDoc: (doc) => sharedInfo.get(doc)?.space ?? spaceByDoc.value.get(doc),
    membersOf: (space) => spaces.get(space)?.members.map((m) => m.id),
  })
})
