import { describe, expect, it } from 'vitest'
import type { Bookmark, BrowserTab } from '../../src/shared/browser'
import { bookmarkFolders, findBookmark, flatBookmarks, insertBookmark, parentOfBookmark, withoutBookmarks, withTabIcons } from '../../src/shared/browser/bookmarkTree'

/** A bar: a page, a folder (a page, a folder inside it with a page), another page. */
const tree = (): Bookmark[] => [
  { id: 'a', title: 'A', url: 'https://a.test/' },
  {
    id: 'f',
    title: 'Work',
    children: [
      { id: 'b', title: 'B', url: 'https://b.test/' },
      { id: 'g', title: 'Docs', children: [{ id: 'c', title: 'C', url: 'https://c.test/' }] },
    ],
  },
  { id: 'd', title: 'D', url: 'https://d.test/' },
]
const ids = (l: Bookmark[]): unknown[] => l.map((b) => (b.children ? [b.id, ids(b.children)] : b.id))

describe('the bookmarks tree', () => {
  it('finds at any depth; its folder', () => {
    expect(findBookmark(tree(), (b) => b.url === 'https://c.test/')?.id).toBe('c')
    expect(findBookmark(tree(), (b) => b.id === 'none')).toBeUndefined()
    expect(parentOfBookmark(tree(), 'c')?.id).toBe('g')
    expect(parentOfBookmark(tree(), 'b')?.id).toBe('f')
    expect(parentOfBookmark(tree(), 'a')).toBeUndefined()
  })
  it('takes out at any depth, the old tree untouched', () => {
    const t = tree()
    expect(ids(withoutBookmarks(t, (b) => b.id === 'c' || b.id === 'a'))).toEqual([['f', ['b', ['g', []]]], 'd'])
    expect(ids(t)).toEqual(['a', ['f', ['b', ['g', ['c']]]], 'd'])
  })
  it('puts into the bar or a folder, at a place or the end', () => {
    const x: Bookmark = { id: 'x', title: 'X', url: 'https://x.test/' }
    expect(ids(insertBookmark(tree(), undefined, x))).toEqual(['a', ['f', ['b', ['g', ['c']]]], 'd', 'x'])
    expect(ids(insertBookmark(tree(), undefined, x, 1))).toEqual(['a', 'x', ['f', ['b', ['g', ['c']]]], 'd'])
    expect(ids(insertBookmark(tree(), 'g', x, 0))).toEqual(['a', ['f', ['b', ['g', ['x', 'c']]]], 'd'])
    expect(ids(insertBookmark(tree(), 'f', x, 99))).toEqual(['a', ['f', ['b', ['g', ['c']], 'x']], 'd'])
  })
  it('its folders indented by depth; its pages flat', () => {
    expect(bookmarkFolders(tree())).toEqual([
      { id: 'f', title: 'Work' },
      { id: 'g', title: '  Docs' },
    ])
    expect(flatBookmarks(tree(), 10).map((b) => b.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(flatBookmarks(tree(), 2).map((b) => b.id)).toEqual(['a', 'b'])
  })
  it('a bookmark without an icon takes it from a tab of its page; nothing new — none', () => {
    const tab = (url: string, favicon?: string) => ({ id: url, url, title: '', loading: false, canBack: false, canFwd: false, zoom: 100, favicon }) as BrowserTab
    const next = withTabIcons(tree(), [tab('https://c.test/', 'data:image/png;base64,AA'), tab('https://d.test/')])
    expect(findBookmark(next!, (b) => b.id === 'c')?.icon).toBe('data:image/png;base64,AA')
    expect(findBookmark(next!, (b) => b.id === 'd')?.icon).toBeUndefined()
    expect(withTabIcons(tree(), [tab('https://d.test/')])).toBeUndefined()
  })
})
