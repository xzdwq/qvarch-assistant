import { describe, expect, it } from 'vitest'
import { parser } from '@lezer/markdown'
import { looseFence } from '../src/shared/mdLooseFence'

const doc = ['Закомментировать блок', '', '```', '// code', '       ```', '', '## После блока', '', 'Текст **жирный**'].join('\n')
const names = (p: typeof parser) => {
  const out: string[] = []
  p.parse(doc).iterate({ enter: (n) => void out.push(`${n.name}@${n.from}-${n.to}`) })
  return out
}

describe('a fenced block closed with an indented fence', () => {
  it('the standard parser leaves it open to the end (the heading below is code)', () => {
    expect(names(parser).some((n) => n.startsWith('ATXHeading2'))).toBe(false)
  })
  it('ours closes it there: the heading and the bold text below are Markdown again', () => {
    const got = names(parser.configure(looseFence))
    const code = got.find((n) => n.startsWith('FencedCode'))!
    expect(Number(code.split('-')[1])).toBeLessThan(doc.indexOf('## После'))
    expect(got.some((n) => n.startsWith('ATXHeading2'))).toBe(true)
    expect(got.some((n) => n.startsWith('StrongEmphasis'))).toBe(true)
  })
})
