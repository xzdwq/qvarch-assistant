import { describe, expect, it } from 'vitest'
import { fromB64, isEmptyUpdate, isPeerSel, SharedText, toB64 } from '../../src/shared/transport/sharedText'
import { normalizeInvite, sharedDocOf, showInvite, withSharedMark } from '../../src/shared/transport/space'
import { spliceOf, splicesOf } from '../../src/shared/textSplice'

const DOC = '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b'

describe('a component\'s origin in a shared note', () => {
  const pair = () => {
    const a = new SharedText()
    const b = new SharedText()
    a.onUpdate((u, o) => o === 'local' && b.apply(u, 'remote'))
    b.onUpdate((u, o) => o === 'local' && a.apply(u, 'remote'))
    return { a, b }
  }
  const who = { by: 'Альфа', device: 'dev-a', at: 1_000 }
  it('marked by the one who put it in — the others see it, at its first sign, wherever edits move it', () => {
    const { a, b } = pair()
    a.setLocal('Текст\n```sql\nselect 1\n```\n')
    a.markOrigin(6, who)
    expect([...b.originsNow()]).toEqual([[6, who]])
    // a line typed above it (by the other one): the origin follows the component
    b.setLocal('Новая строка\nТекст\n```sql\nselect 1\n```\n')
    expect([...a.originsNow()]).toEqual([[19, who]])
    // its own lines edited — still its
    a.setLocal('Новая строка\nТекст\n```sql name=rows\nselect 2\n```\n')
    expect(b.originsNow().get(19)).toEqual(who)
  })
  it('the component deleted — its origin gone (another one put in at the same place is not taken for it)', () => {
    const { a, b } = pair()
    a.setLocal('```sql\nselect 1\n```\n')
    a.markOrigin(0, who)
    b.setLocal('')
    b.setLocal('```sql\nselect 2\n```\n')
    expect(a.originsNow().size).toBe(0)
  })
  it('a caret is one place: someone typing right at it — their text goes after it, never «selected» by it', () => {
    const { a, b } = pair()
    a.setLocal('слово')
    const caret = { ...a.caret(5), caretAtStart: false }
    b.setLocal('слово дальше')
    expect(a.resolve(caret)).toMatchObject({ from: 5, to: 5 })
  })
  it('each line knows who changed it last (a deletion too); unmarked text — nobody', () => {
    const { a, b } = pair()
    let t = 100
    a.stamp = () => ({ device: 'dev-a', at: (t += 1) })
    b.stamp = () => ({ device: 'dev-b', at: (t += 1) })
    a.setLocal('первая\nвторая\nтретья')
    expect([...b.lineAuthors()]).toEqual([[0, 'dev-a'], [1, 'dev-a'], [2, 'dev-a']])
    // Бета continues Альфа's word on the second line — the line is hers now; her text never takes Альфа's mark
    b.setLocal('первая\nвторая-ещё\nтретья')
    expect([...a.lineAuthors()]).toEqual([[0, 'dev-a'], [1, 'dev-b'], [2, 'dev-a']])
    // a deletion alone on the third line — the line is the one who deleted's
    a.setLocal('первая\nвторая-ещё\nтреть')
    expect(b.lineAuthors().get(2)).toBe('dev-a')
    a.setLocal('первая\nвторая-ещё\nтреть')
    const plain = new SharedText()
    plain.setLocal('без отметок')
    expect(plain.lineAuthors().size).toBe(0)
  })
  it('a cursor told as a place that follows the text; a wrong one refused', () => {
    const a = new SharedText()
    a.setLocal('abcdef')
    const sel = { ...a.anchor(2, 4), caretAtStart: true }
    expect(isPeerSel(sel)).toBe(true)
    expect(isPeerSel({ ...sel, start: 'не base64!' })).toBe(false)
    expect(isPeerSel({ start: sel.start, end: sel.end })).toBe(false)
    a.setLocal('XXabcdef')
    expect(a.resolve(sel)).toMatchObject({ from: 4, to: 6 })
  })
})

describe('a shared note after a restart', () => {
  /** The server's copy and this computer's: typed here, sent there. */
  function typed() {
    const here = new SharedText()
    const server = new SharedText()
    here.onUpdate((u) => server.apply(u, 'remote'))
    here.setLocal('Привет')
    return { here, server }
  }
  it('kept with the text it holds — the same file: nothing typed twice when it meets the server again', () => {
    const { here, server } = typed()
    const kept = { state: toB64(here.state()), text: here.value }
    const again = new SharedText()
    again.resume(kept, 'Привет')
    server.apply(again.missingFor(server.stateVector()), 'remote')
    again.apply(server.missingFor(again.stateVector()), 'remote')
    expect([again.value, server.value]).toEqual(['Привет', 'Привет'])
  })
  it('the file changed while the app was closed — the change goes in once', () => {
    const { here, server } = typed()
    const again = new SharedText()
    again.resume({ state: toB64(here.state()), text: here.value }, 'Привет, мир')
    server.apply(again.missingFor(server.stateVector()), 'remote')
    expect(server.value).toBe('Привет, мир')
  })
  it('a state kept before its text was (an older app) — the file counts as changed', () => {
    const { here } = typed()
    const again = new SharedText()
    again.resume({ state: toB64(here.state()) }, 'Привет!')
    expect(again.value).toBe('Привет!')
  })
})

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
