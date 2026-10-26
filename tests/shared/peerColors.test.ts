import { describe, expect, it } from 'vitest'
import { PEER_SLOTS, peerHashSlot, peerSlots, slotOf } from '../../src/shared/transport/peerColors'

/** Devices whose own slots collide (found by search: the same hash slot). */
function colliding(n: number): string[] {
  const out: string[] = []
  const want = peerHashSlot('dev-0')
  for (let i = 0; out.length < n; i++) if (peerHashSlot(`dev-${i}`) === want) out.push(`dev-${i}`)
  return out
}

describe('peer colours', () => {
  it('gives members whose own colours collide different ones', () => {
    const [a, b] = colliding(2)
    const s = peerSlots([a, b])
    expect(s.get(a)).toBe(peerHashSlot(a))
    expect(s.get(b)).not.toBe(s.get(a))
  })

  it('all members differ while the colours last', () => {
    const ids = colliding(PEER_SLOTS)
    expect(new Set(peerSlots(ids).values()).size).toBe(PEER_SLOTS)
  })

  it('a newcomer keeps the others’ colours', () => {
    const ids = colliding(3)
    const before = peerSlots(ids.slice(0, 2))
    const after = peerSlots(ids)
    for (const id of ids.slice(0, 2)) expect(after.get(id)).toBe(before.get(id))
  })

  it('more members than colours — the rest by their own', () => {
    const ids = colliding(PEER_SLOTS + 1)
    const last = ids[PEER_SLOTS]
    expect(peerSlots(ids).get(last)).toBe(peerHashSlot(last))
  })

  it('one not among the members — by their device', () => {
    expect(slotOf(new Map(), 'x')).toBe(peerHashSlot('x'))
  })
})
