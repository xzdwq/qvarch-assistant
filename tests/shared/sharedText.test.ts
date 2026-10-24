import { describe, expect, it } from 'vitest'
import { fromB64, isEmptyUpdate, SharedText, toB64 } from '../../src/shared/transport/sharedText'
import { normalizeInvite, sharedDocOf, showInvite, withSharedMark } from '../../src/shared/transport/space'
import { spliceOf, splicesOf } from '../../src/shared/textSplice'

const DOC = '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b'

/** Two copies of one document kept in step by their updates (as the server passes them). */
function pair() {
  const a = new SharedText()
  const b = new SharedText()
  a.setLocal('# Заметка\n\nпервая строка\nвторая строка\n')
  b.apply(a.state(), 'remote')
  return { a, b }
}

describe('the smallest replace between two texts', () => {
  it('the middle that differs; none for the same', () => {
    expect(spliceOf('abcdef', 'abXYef')).toEqual({ at: 2, del: 2, ins: 'XY' })
    expect(spliceOf('abc', 'abcd')).toEqual({ at: 3, del: 0, ins: 'd' })
    expect(spliceOf('aaa', 'aa')).toEqual({ at: 2, del: 1, ins: '' })
    expect(spliceOf('x', 'x')).toBeNull()
  })
  it('a change at two places — two replaces, the text between kept; applied last first they give the new text', () => {
    const a = 'один два три четыре'
    const b = 'ОДИН два три ЧЕТЫРЕ'
    const ss = splicesOf(a, b)
    expect(ss.length).toBeGreaterThan(1)
    expect(ss.every((s) => s.at + s.del <= 'один'.length || s.at >= 'один два три '.length)).toBe(true)
    let t = a
    for (const s of ss) t = t.slice(0, s.at) + s.ins + t.slice(s.at + s.del)
    expect(t).toBe(b)
    expect(splicesOf('x', 'x')).toEqual([])
  })
})

describe('a shared note\'s text', () => {
  it('edits of different places made at once — both kept, the same at both', () => {
    const { a, b } = pair()
    const sa = b.stateVector()
    const sb = a.stateVector()
    a.setLocal(a.value.replace('первая', 'ПЕРВАЯ'))
    b.setLocal(`${b.value}третья строка\n`)
    b.apply(a.missingFor(sa), 'remote')
    a.apply(b.missingFor(sb), 'remote')
    expect(a.value).toBe('# Заметка\n\nПЕРВАЯ строка\nвторая строка\nтретья строка\n')
    expect(b.value).toBe(a.value)
  })
  it('the same place typed at both — both texts kept, nothing lost', () => {
    const { a, b } = pair()
    const sa = b.stateVector()
    const sb = a.stateVector()
    a.setLocal(a.value.replace('вторая', 'вторая А'))
    b.setLocal(b.value.replace('вторая', 'вторая Б'))
    b.apply(a.missingFor(sa), 'remote')
    a.apply(b.missingFor(sb), 'remote')
    expect(a.value).toBe(b.value)
    expect(a.value).toMatch(/вторая( А| Б){2} строка/)
  })
  it('a whole block replaced by its new text — only what changed goes in', () => {
    const { a } = pair()
    let sent = 0
    a.onUpdate((u, o) => o === 'local' && (sent += u.length))
    a.setLocal(a.value.replace('вторая строка', 'вторая строкa'))
    expect(sent).toBeLessThan(40)
  })
  it('the kept state restored; what the server lacks; an empty update told apart', () => {
    const { a } = pair()
    const copy = new SharedText()
    copy.apply(fromB64(toB64(a.state())), 'load')
    expect(copy.value).toBe(a.value)
    expect(isEmptyUpdate(a.missingFor(copy.stateVector()))).toBe(true)
    copy.setLocal(`${copy.value}+`)
    expect(isEmptyUpdate(copy.missingFor(a.stateVector()))).toBe(false)
    expect(copy.setLocal(copy.value)).toBe(false)
  })
})

describe('a comment\'s place', () => {
  it('goes with the text: others\' edits before it and inside it; its text deleted — gone, at its place', () => {
    const { a, b } = pair()
    const at = a.value.indexOf('вторая')
    const anchor = a.anchor(at, at + 'вторая'.length)
    // someone else writes before it and inside it
    const sb = a.stateVector()
    b.setLocal(b.value.replace('# Заметка', '# Заметка про всё').replace('вторая', 'вто-рая'))
    a.apply(b.missingFor(sb), 'remote')
    const r = a.resolve(anchor)!
    expect(a.value.slice(r.from, r.to)).toBe('вто-рая')
    expect(r.gone).toBe(false)
    // the place's text deleted
    a.setLocal(a.value.replace('вто-рая строка\n', ''))
    expect(a.resolve(anchor)).toMatchObject({ gone: true })
    // known on the other copy too (the positions travel)
    b.apply(a.missingFor(b.stateVector()), 'remote')
    expect(b.resolve(anchor)).toMatchObject({ gone: true })
    expect(new SharedText().resolve(anchor)).toBeNull()
  })
})

describe('a shared note\'s mark and an invitation', () => {
  it('the mark on the first line, read back; a marked text kept as is', () => {
    const t = withSharedMark('# x', DOC)
    expect(t).toBe(`<!-- qa:shared doc=${DOC} -->\n# x`)
    expect(sharedDocOf(t)).toBe(DOC)
    expect(withSharedMark(t, DOC)).toBe(t)
    expect(sharedDocOf(`# x\n<!-- qa:shared doc=${DOC} -->`)).toBe('')
  })
  it('a code as typed and as shown', () => {
    expect(normalizeInvite(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(showInvite('ABCDEFGH')).toBe('ABCD-EFGH')
  })
})
