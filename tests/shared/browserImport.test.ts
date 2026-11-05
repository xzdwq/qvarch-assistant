import { describe, expect, it } from 'vitest'
import { chromiumBookmarks, countLinks, newBookmarksOnly, parseCsv, passwordsCsv } from '../../src/shared/browser/browserImport'

const file = JSON.stringify({
  roots: {
    bookmark_bar: { type: 'folder', name: 'Панель', children: [{ type: 'url', name: 'A', url: 'https://a.example/' }, { type: 'folder', name: 'Работа', children: [{ type: 'url', name: 'B', url: 'https://b.example/x' }, { type: 'url', name: 'JS', url: 'javascript:void 0' }] }] },
    other: { type: 'folder', name: 'Другие закладки', children: [{ type: 'url', name: 'C', url: 'https://c.example/' }] },
    synced: { type: 'folder', name: 'Мобильные', children: [] },
  },
})

describe('moving in from another browser', () => {
  it('a Chromium profile’s bookmarks: one folder, the bar at its top, the other roots as folders, empty ones and scripts left out', () => {
    const f = chromiumBookmarks(file, 'Brave')!
    expect(f.title).toBe('Brave')
    expect(f.children!.map((b) => b.title)).toEqual(['A', 'Работа', 'Другие закладки'])
    expect(countLinks([f])).toBe(3)
  })
  it('links already here are left out; a folder left empty goes', () => {
    const f = chromiumBookmarks(file, 'Brave')!
    const r = newBookmarksOnly(f, [{ id: '1', title: 'x', children: [{ id: '2', title: 'b', url: 'https://b.example/x' }] }])
    expect(r).toMatchObject({ added: 2, skipped: 1 })
    expect(r.folder!.children!.map((b) => b.title)).toEqual(['A', 'Другие закладки'])
    expect(newBookmarksOnly(f, [{ id: '1', title: 'a', url: 'https://a.example/' }, { id: '2', title: 'b', url: 'https://b.example/x' }, { id: '3', title: 'c', url: 'https://c.example/' }]).folder).toBeUndefined()
  })
  it('reads a CSV: quotes, "" inside, a line break inside a cell, a byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ])
  })
  it('passwords of Chromium’s and Firefox’s files by their header; an app’s login and an empty password left out', () => {
    const chromium = 'name,url,username,password,note\nsite,https://s.example/login,me,p1,\napp,android://x@com.app/,me,p2,\nnone,https://n.example/,me,,\n'
    expect(passwordsCsv(chromium)).toEqual({ logins: [{ origin: 'https://s.example', username: 'me', password: 'p1' }], skipped: 2 })
    const firefox = '"url","username","password","httpRealm"\n"https://f.example","u","p",""\n'
    expect(passwordsCsv(firefox).logins).toEqual([{ origin: 'https://f.example', username: 'u', password: 'p' }])
    expect(() => passwordsCsv('a,b\n1,2')).toThrow(/столбцы url и password/)
  })
})
