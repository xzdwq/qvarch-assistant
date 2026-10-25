import { describe, expect, it } from 'vitest'
import { agentLineMarks, agentLinesAfter, firstWrittenLine, lineHash } from '../../src/shared/notebook/agentLines'
import { docLink, linkParts, parseDocLink, placeKey, placeLine, withPlaces } from '../../src/shared/notebook/links'
import { SharedText } from '../../src/shared/transport/sharedText'

describe('the lines an agent wrote in a personal note', () => {
  it('its new lines are its; lines of signs only are nobody’s; a line changed is no longer its', () => {
    const before = '# План\nсвоё\n'
    const after = '# План\nсвоё\n\n## Итог\n```work\nperiod: this-week\n```\n---\n'
    const kept = agentLinesAfter({}, before, after, 'ИИ · a')
    expect([...agentLineMarks(after, kept)]).toEqual([
      [3, 'ИИ · a'],
      [4, 'ИИ · a'],
      [5, 'ИИ · a'],
    ])
    const edited = after.replace('## Итог', '## Итог недели')
    expect([...agentLineMarks(edited, kept).keys()]).toEqual([4, 5])
  })
  it('a blank line between two of its lines is its too (one run); one before a person’s line is not', () => {
    const after = 'своё\n\nпервая\n\nвторая\n\nещё своё\n'
    const kept = agentLinesAfter({}, 'своё\n\nещё своё\n', after, 'ИИ')
    expect([...agentLineMarks(after, kept).keys()].sort()).toEqual([2, 3, 4])
  })
  it('the place a change starts: its first new line with words', () => {
    expect(firstWrittenLine('# A\nb\n', '# A\nb\n\n---\n## Итоги\nтекст\n')).toBe('## Итоги')
    expect(firstWrittenLine('a', 'a\n```\n')).toBeUndefined()
  })
  it('the record keeps only what the text still has', () => {
    const kept = agentLinesAfter({ [lineHash('старое')]: 'x' }, '', 'новое', 'y')
    expect(kept).toEqual({ [lineHash('новое')]: 'y' })
  })
})

describe('places in links', () => {
  it('a place is a heading or a line’s start, found again after the text moved', () => {
    const text = 'intro\n\n## Итоги недели\n- **AI-107**: переименование [сервиса](x)\n'
    expect(placeLine(text, 'Итоги недели')).toBe(2)
    expect(placeLine(`новая строка\n${text}`, placeKey('- **AI-107**: переименование [сервиса](x)'))).toBe(4)
    expect(placeLine(text, 'нет такого')).toBeUndefined()
  })
  it('a shared note’s link carries its place', () => {
    const l = docLink('0f5c2b8e-1111-4222-8333-944455556666', 'Док', 'abcd', 'Итоги (неделя)')
    const url = /\((qvarch:[^)]+)\)/.exec(l)![1]
    expect(parseDocLink(url)).toEqual({ doc: '0f5c2b8e-1111-4222-8333-944455556666', join: 'abcd', place: 'Итоги неделя' })
  })
  it('an answer’s links to what it wrote get the place; those that name one stay', () => {
    const doc = 'qvarch://doc/0f5c2b8e-1111-4222-8333-944455556666'
    const text = `Готово: [[Отчёт]], [[Отчёт#Своё]], [общий](${doc}) и https://example.com`
    const out = withPlaces(text, (l) => (l.kind === 'note' || l.kind === 'doc' ? '## Итоги' : undefined))
    expect(out).toBe(`Готово: [[Отчёт#Итоги]], [[Отчёт#Своё]], [общий](${doc}#%D0%98%D1%82%D0%BE%D0%B3%D0%B8) и https://example.com`)
    expect(linkParts(out).filter((p) => p.link).map((p) => p.link!.kind)).toEqual(['note', 'note', 'doc'])
  })
})

describe('a shared note’s lines written by an agent', () => {
  it('marked with the agent; a person’s edit of the line makes it theirs again', () => {
    const t = new SharedText()
    let at = 1
    t.stamp = () => ({ device: 'dev-a', at: at++ })
    t.setLocal('своё\n')
    t.setLocal('своё\nот агента\n', 'ИИ · a')
    expect(t.lineAuthors().get(1)).toEqual({ device: 'dev-a', agent: 'ИИ · a' })
    expect(t.lineAuthors().get(0)).toEqual({ device: 'dev-a' })
    t.setLocal('своё\nот агента!\n')
    expect(t.lineAuthors().get(1)).toEqual({ device: 'dev-a' })
  })
  it('a line put in after a person’s line never makes that line the agent’s', () => {
    const t = new SharedText()
    let at = 1
    t.stamp = () => ({ device: 'dev-a', at: at++ })
    t.setLocal('человек\nдальше')
    t.setLocal('человек\n\nот агента\nдальше', 'ИИ')
    expect([...t.lineAuthors()].map(([l, w]) => [l, w.agent ?? 'человек'])).toEqual([
      [0, 'человек'],
      [1, 'ИИ'],
      [2, 'ИИ'],
      [3, 'человек'],
    ])
  })
})
