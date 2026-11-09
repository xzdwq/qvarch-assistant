import { describe, expect, it } from 'vitest'
import { findBlocks } from '../../src/notebook/domain/findBlocks'

describe('the table of contents written as other editors do', () => {
  it('a line [toc] / [TOC] alone is the contents; the fence still is; in a sentence or in code — text', () => {
    const lines = ['# Доклад', '', '[toc]', '', '[TOC]', '', '```toc', '```', '', 'см. [toc] выше', '', '```md', '[toc]', '```']
    expect(findBlocks(lines).map((b) => [b.kind, b.line0])).toEqual([
      ['toc', 3],
      ['toc', 5],
      ['toc', 7],
    ])
  })
})
