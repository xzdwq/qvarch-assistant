/**
 * The participants' colours in a shared document (`--peer-1…`): the cursor, the lines one changed last, the mark in
 * «Совместная работа». Given by the members' order (the order they joined — the same for everyone), each takes its own
 * free colour, so two people never share one while the colours last; one not among the members (left already) — by
 * their device alone.
 */
export const PEER_SLOTS = 8

/** A device's own colour slot (0…PEER_SLOTS-1): the one it takes when free. */
export const peerHashSlot = (id: string): number => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_SLOTS

/**
 * Each member's colour slot: in order, its own when free, else the next free one; more members than colours — the
 * ones past them by their own (repeats can't be helped then). A newcomer never changes the others' colours.
 */
export function peerSlots(members: readonly string[]): Map<string, number> {
  const out = new Map<string, number>()
  const taken = new Set<number>()
  for (const id of members) {
    if (out.has(id)) continue
    const own = peerHashSlot(id)
    let slot = own
    if (taken.size < PEER_SLOTS) while (taken.has(slot)) slot = (slot + 1) % PEER_SLOTS
    taken.add(slot)
    out.set(id, slot)
  }
  return out
}

/** A device's slot by the members' slots (not among them — its own). */
export const slotOf = (slots: ReadonlyMap<string, number>, id: string): number => slots.get(id) ?? peerHashSlot(id)
