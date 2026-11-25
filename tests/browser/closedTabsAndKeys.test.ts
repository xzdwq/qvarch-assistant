import { describe, expect, it } from 'vitest'
import { CLOSED_KEEP, cleanClosed, takeClosed, withClosed, type ClosedTab } from '../../src/shared/browser/closedTabs'
import { cleanExternalMemory, externalAllowed, externalScheme, siteOf, withExternalAllowed } from '../../src/shared/browser/externalLinks'
import { shortcutLetter } from '../../src/shared/browser/shortcutKey'

const tab = (id: string, at = 1): ClosedTab => ({ id, url: `https://site.test/${id}`, title: id, at })

describe('closed tabs', () => {
  it('newest first, at most the limit', () => {
    let list: ClosedTab[] = []
    for (let i = 0; i < CLOSED_KEEP + 5; i++) list = withClosed(list, tab(`t${i}`, i))
    expect(list).toHaveLength(CLOSED_KEEP)
    expect(list[0].id).toBe(`t${CLOSED_KEEP + 4}`)
    expect(list.at(-1)!.id).toBe('t5')
  })
  it('taken: the last closed, or the one named; none left — nothing', () => {
    const list = [tab('c'), tab('b'), tab('a')]
    expect(takeClosed(list)).toEqual({ tab: list[0], rest: [list[1], list[2]] })
    expect(takeClosed(list, 'a')).toEqual({ tab: list[2], rest: [list[0], list[1]] })
    expect(takeClosed(list, 'x')).toEqual({ rest: list })
    expect(takeClosed([])).toEqual({ rest: [] })
  })
  it('as written: broken ones dropped, a place only when whole, an icon only as a picture', () => {
    const raw = [{ ...tab('a'), pane: 1, index: 2, favicon: 'data:image/png;base64,AA' }, { ...tab('b'), pane: 1 }, { id: 'c', url: 5 }, null, { ...tab('d'), favicon: 'https://x/i.png' }]
    expect(cleanClosed(raw)).toEqual([{ ...tab('a'), pane: 1, index: 2, favicon: 'data:image/png;base64,AA' }, tab('b'), tab('d')])
    expect(cleanClosed('x')).toEqual([])
  })
})

describe("an application's links", () => {
  it("a scheme the browser does not show itself is an application's", () => {
    expect(externalScheme('mailto:a@b.c')).toBe('mailto')
    expect(externalScheme(' TEL:123')).toBe('tel')
    expect(externalScheme('ms-teams:x')).toBe('ms-teams')
    for (const own of ['https://a.b', 'http://a', 'file:///C:/a', 'about:blank', 'data:text/plain,x', 'blob:https://a/1', 'javascript:void 0', 'chrome://settings', 'qa-source:https://a', 'view-source:https://a'])
      expect(externalScheme(own)).toBeUndefined()
    expect(externalScheme('no scheme here')).toBeUndefined()
    expect(externalScheme('/relative')).toBeUndefined()
    expect(externalScheme('C:\\Users\\a.txt')).toBeUndefined()
  })
  it('a site allowed a scheme is remembered; the rest asks', () => {
    const m = withExternalAllowed({}, 'https://a.test', 'mailto')
    expect(externalAllowed(m, 'https://a.test', 'mailto')).toBe(true)
    expect(externalAllowed(m, 'https://a.test', 'tel')).toBe(false)
    expect(externalAllowed(m, 'https://b.test', 'mailto')).toBe(false)
    expect(withExternalAllowed(m, 'https://a.test', 'mailto')).toBe(m)
    expect(withExternalAllowed(m, 'https://a.test', 'tel')['https://a.test']).toEqual(['mailto', 'tel'])
    expect(externalAllowed({}, 'constructor', 'x')).toBe(false)
  })
  it('the memory as written; the site of a page', () => {
    expect(cleanExternalMemory({ 'https://a': ['mailto', 'mailto', 3, 'BAD SCHEME'], 'https://b': [] })).toEqual({ 'https://a': ['mailto'] })
    expect(cleanExternalMemory([1])).toEqual({})
    expect(siteOf('https://a.test:8443/x?y')).toBe('https://a.test:8443')
    expect(siteOf('about:blank')).toBeUndefined()
    expect(siteOf('nonsense')).toBeUndefined()
  })
})

describe('a shortcut by the key, whatever the layout', () => {
  it('a letter by its place; other keys by name', () => {
    expect(shortcutLetter('е', 'KeyT')).toBe('t')
    expect(shortcutLetter('T', 'KeyT')).toBe('t')
    expect(shortcutLetter('а', 'KeyF')).toBe('f')
    expect(shortcutLetter('F5', 'F5')).toBe('f5')
    expect(shortcutLetter('-', 'Minus')).toBe('-')
    expect(shortcutLetter('x')).toBe('x')
  })
})
