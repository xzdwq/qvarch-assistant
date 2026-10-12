import { describe, expect, it } from 'vitest'
import { addLink, linkedTo, pruneLinks, remapLinks, setLinksOf } from '../src/shared/links'
import type { Entry, Link, Note } from '../src/shared/types'

const E = (id: string) => ({ type: 'entry' as const, id })
const N = (id: string) => ({ type: 'note' as const, id })
let n = 0
const id = () => `l${++n}`

describe('links', () => {
  it('adds a link once, in either direction, never to itself', () => {
    let l: Link[] = []
    l = addLink(l, E('a'), E('b'), id(), 0)
    l = addLink(l, E('b'), E('a'), id(), 0)
    l = addLink(l, E('a'), E('a'), id(), 0)
    expect(l).toHaveLength(1)
    expect(linkedTo(l, E('b')).map((x) => x.other)).toEqual([E('a')])
  })
  it('setLinksOf makes the links of one end exactly the given list', () => {
    let l: Link[] = [{ id: 'x', a: E('a'), b: E('b'), at: 0 }, { id: 'y', a: N('n'), b: E('a'), at: 0 }, { id: 'z', a: E('c'), b: E('d'), at: 0 }]
    l = setLinksOf(l, E('a'), [N('n'), E('c')], id, 0)
    expect(linkedTo(l, E('a')).map((x) => x.other)).toEqual([N('n'), E('c')])
    expect(l.some((x) => x.id === 'z')).toBe(true)
  })
  it('drops links to deleted things and moves links of merged blocks', () => {
    const l: Link[] = [{ id: 'x', a: E('a'), b: E('b'), at: 0 }, { id: 'y', a: E('b'), b: N('n'), at: 0 }]
    const entries = [{ id: 'b' }] as Entry[]
    const notes = [{ id: 'n' }] as Note[]
    expect(pruneLinks({ day: 'd', entries, notes, links: l }).map((x) => x.id)).toEqual(['y'])
    const m = remapLinks([...l, { id: 'z', a: E('a'), b: N('n'), at: 0 }], ['b'], 'a')
    // a–b becomes a self-link (dropped); b–n and a–n become the same pair (one kept)
    expect(m).toHaveLength(1)
    expect(linkedTo(m, N('n')).map((x) => x.other)).toEqual([E('a')])
  })
  it('links across days: an end on another day is kept; the editor list does not drop them', () => {
    const l: Link[] = [{ id: 'x', a: { type: 'entry', id: 'a', day: 'd1' }, b: { type: 'entry', id: 'z', day: 'd2' }, at: 0 }]
    expect(pruneLinks({ day: 'd1', entries: [{ id: 'a' }] as Entry[], notes: [], links: l })).toHaveLength(1)
    expect(pruneLinks({ day: 'd1', entries: [] as Entry[], notes: [], links: l })).toHaveLength(0)
    expect(setLinksOf(l, E('a'), [], id, 0)).toHaveLength(1)
  })
})
