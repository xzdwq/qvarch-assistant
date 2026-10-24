import { describe, expect, it } from 'vitest'
import { applyBoardDiff, diffBoards, newBoard, parseBoard, serializeBoard, type Board, type BoardItem } from '../../src/shared/whiteboard'
import { SharedBoard } from '../../src/shared/transport/sharedBoard'
import { formatOf, sharedDocOfFile } from '../../src/shared/transport/sharedFormats'

const DOC = '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b'
const ink = (id: string, x = 0): BoardItem => ({ id, type: 'ink', pts: [x, 0, 0.5, x + 10, 10, 0.5], color: '#000', size: 4, opacity: 1, streamline: 0.5, smoothing: 0.5, thinning: 0.5, pen: true }) as BoardItem
const board = (...items: BoardItem[]): Board => ({ ...newBoard(), items })
const text = (b: Board) => serializeBoard(b)
const ids = (t: string) => parseBoard(t).items.map((i) => i.id)

/** Two copies of a shared board kept in step by their updates. */
function pair(start: Board) {
  const a = new SharedBoard()
  const b = new SharedBoard()
  a.setLocal(text(start))
  b.apply(a.state(), 'remote')
  return { a, b }
}
function exchange(a: SharedBoard, b: SharedBoard, sa: Uint8Array, sb: Uint8Array): void {
  b.apply(a.missingFor(sa), 'remote')
  a.apply(b.missingFor(sb), 'remote')
}

describe('a shared board', () => {
  it('two drawing at once: both strokes kept, in the same order at both', () => {
    const { a, b } = pair(board(ink('s1')))
    const sa = b.stateVector()
    const sb = a.stateVector()
    a.setLocal(text(board(ink('s1'), ink('a1'))))
    b.setLocal(text(board(ink('s1'), ink('b1'))))
    exchange(a, b, sa, sb)
    expect(a.value).toBe(b.value)
    expect(ids(a.value).sort()).toEqual(['a1', 'b1', 's1'])
  })
  it('one moves a stroke while the other draws and erases: all of it kept', () => {
    const { a, b } = pair(board(ink('s1'), ink('s2')))
    const sa = b.stateVector()
    const sb = a.stateVector()
    a.setLocal(text(board(ink('s1', 100), ink('s2'))))
    b.setLocal(text(board(ink('s1'), ink('b1'))))
    exchange(a, b, sa, sb)
    expect(a.value).toBe(b.value)
    const items = parseBoard(a.value).items
    expect(items.map((i) => i.id)).toEqual(['s1', 'b1'])
    expect((items[0] as { pts: number[] }).pts[0]).toBe(100)
  })
  it('the background and the order (to the front) go too; the same text again — nothing sent', () => {
    const { a, b } = pair(board(ink('s1'), ink('s2')))
    const sa = b.stateVector()
    a.setLocal(text({ ...board(ink('s2'), ink('s1')), bg: { ...newBoard().bg, color: '#123456' } }))
    b.apply(a.missingFor(sa), 'remote')
    expect(ids(b.value)).toEqual(['s2', 's1'])
    expect(parseBoard(b.value).bg.color).toBe('#123456')
    expect(a.setLocal(a.value)).toBe(false)
  })
})

describe('a board\'s own undo over others\' changes', () => {
  it('undoing my stroke keeps the one drawn by someone else meanwhile', () => {
    const before = board(ink('s1'))
    const after = board(ink('s1'), ink('mine'))
    const now = board(ink('s1'), ink('mine'), ink('theirs'))
    expect(applyBoardDiff(now, diffBoards(after, before)).items.map((i) => i.id)).toEqual(['s1', 'theirs'])
    // and again — in its place
    const undone = applyBoardDiff(now, diffBoards(after, before))
    expect(applyBoardDiff(undone, diffBoards(before, after)).items.map((i) => i.id)).toEqual(['s1', 'mine', 'theirs'])
  })
})

describe('a board\'s mark', () => {
  it('in its JSON, read without parsing it; kept through a parse; taken away', () => {
    const f = formatOf('Доски/План.qboard')!
    const marked = f.mark(text(board(ink('s1'))), DOC)
    expect(sharedDocOfFile('x.qboard', marked)).toBe(DOC)
    expect(serializeBoard(parseBoard(marked))).toBe(marked)
    expect(sharedDocOfFile('x.qboard', f.unmark(marked))).toBe('')
    expect(formatOf('a.md')!.kind).toBe('note')
    expect(formatOf('a.png')).toBeUndefined()
  })
})
