import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { componentRanges, componentRangesField } from '../../src/notebook/editor/components/componentField'

/** The editor's component ranges: what live preview, the guard and drag and drop go by. */
const stateOf = (lines: string[]) => EditorState.create({ doc: lines.join('\n'), extensions: [componentRangesField] })

describe('editor: component ranges', () => {
  it('finds the components with their loop, band and the contents headings', () => {
    const s = stateOf(['# Один', '```toc', '```', '<!-- qa:loop name=l -->', '```js loop', 'x', '```', '```http name=a', 'GET /', '```', '<!-- /qa:loop -->', '## Два'])
    const rs = componentRanges(s)
    expect(rs.map((r) => [r.kind, r.line, r.loop, r.band])).toEqual([
      ['toc', 2, '', 0],
      ['loop', 4, '', 1],
      ['http', 8, 'l', 1],
      ['loopEnd', 11, '', 1],
    ])
    expect(JSON.parse(rs[0].headings)).toEqual([
      { level: 1, text: 'Один', pos: 0 },
      { level: 2, text: 'Два', pos: s.doc.line(12).from },
    ])
    expect(rs[2].headings).toBe('')
    expect(s.sliceDoc(rs[2].from, rs[2].to)).toBe(rs[2].src)
  })
  it('follows the text: found again when it changes', () => {
    const s = stateOf(['text'])
    expect(componentRanges(s)).toEqual([])
    const s2 = s.update({ changes: { from: s.doc.length, insert: '\n| a |\n|---|\n| 1 |' } }).state
    expect(componentRanges(s2).map((r) => r.kind)).toEqual(['table'])
  })
  it('a state without the field has no components', () => {
    expect(componentRanges(EditorState.create({ doc: '```toc\n```' }))).toEqual([])
  })
})
