import { describe, expect, it } from 'vitest'
import { tagSpans, tagsIn } from '../../src/notebook/domain/graph/tags'

describe('a value in quotes or after = is no tag', () => {
  it('an SVG / HTML line written in the text: its colours stay text', () => {
    expect(tagSpans('<rect x="35" y="85" width="170" height="30" rx="15" fill="#fff" stroke="#93c5fd"/><text x="120" y="105">')).toEqual([])
    expect(tagSpans("<div style='color:red' data-c='#abc'>")).toEqual([])
    expect(tagSpans('fill=#fff')).toEqual([])
  })
  it('a tag beside them is still one', () => {
    expect(tagsIn('Цвет "#93c5fd" для #дизайн').map((t) => t.label)).toEqual(['дизайн'])
  })
})
