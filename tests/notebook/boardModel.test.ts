import { describe, expect, it } from 'vitest'
import { boardMd, boardModeOf, boardPathOf } from '../../src/notebook/blocks/board/model'

describe('a board in a note', () => {
  it('only shown by default (as before) — drawn on when it says so', () => {
    expect(boardModeOf(boardMd('Доски/План.qboard'))).toBe('view')
    expect(boardModeOf(boardMd('Доски/План.qboard', 'edit'))).toBe('edit')
    expect(boardPathOf(boardMd('Доски/План.qboard', 'edit'))).toBe('Доски/План.qboard')
    // an old block (no mode line) and a mode not known — only shown
    expect(boardModeOf('```board\npath: a.qboard\nmode: draw\n```')).toBe('view')
  })
})
