import { describe, expect, it } from 'vitest'
import type { RecFull, RecLink } from '../../src/shared/browser'
import { addressParts } from '../../src/shared/browser/addressParts'
import { hostKey, parseBody } from '../../src/shared/browser/recordedRequest'
import { linkUseText, prettyBody, requestPath, statusClass } from '../../src/shared/browser/recordingView'

const rec = (o: Partial<RecFull>): RecFull => ({ id: '1', seq: 1, tabId: 't', at: 0, method: 'POST', url: 'https://x.test/', type: 'Fetch', reqHeaders: [], ...o })

describe('the recorded requests as shown', () => {
  it("a request's path and query; its status's class", () => {
    expect(requestPath('https://x.test/api/items?page=2#top')).toBe('/api/items?page=2')
    expect(requestPath('nonsense')).toBe('nonsense')
    expect([undefined, 0, 200, 304, 404, 503].map(statusClass)).toEqual(['', '', 's2', 's3', 'e4', 'e5'])
  })
  it('a JSON body indented, other text as it is', () => {
    expect(prettyBody('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyBody('a=1&b=2')).toBe('a=1&b=2')
    expect(prettyBody(undefined)).toBe('')
  })
  it("where a link's value is used", () => {
    const l: RecLink = { value: '7', from: 0, path: ['id'], varName: 'id_1', on: true, uses: [{ to: 1, where: 'path', key: 'сегмент 2' }, { to: 2, where: 'query', key: 'id' }, { to: 2, where: 'body', key: 'item.id' }, { to: 3, where: 'header', key: 'X-Id' }] }
    expect(linkUseText(l)).toBe('№2 путь, №3 параметр id, №3 тело item.id, №4 заголовок X-Id')
  })
})

describe('a recorded request read', () => {
  it('its body: JSON, a form, multipart (a file to pick again), raw text', () => {
    expect(parseBody(rec({ postData: '{"a":[1]}', reqHeaders: [['Content-Type', 'application/json']] }))).toEqual({ kind: 'json', value: { a: [1] } })
    expect(parseBody(rec({ postData: '[1,2]' }))).toEqual({ kind: 'json', value: [1, 2] })
    const form = parseBody(rec({ postData: 'a=1&b=x%20y', reqHeaders: [['content-type', 'application/x-www-form-urlencoded']] }))
    expect(form.kind === 'rows' && form.rows.map((r) => [r.key, r.value])).toEqual([
      ['a', '1'],
      ['b', 'x y'],
    ])
    const mp = parseBody(rec({ postData: '--XyZ\r\nContent-Disposition: form-data; name="n"\r\n\r\nval\r\n--XyZ\r\nContent-Disposition: form-data; name="f"; filename="a.xlsx"\r\nContent-Type: x\r\n\r\nBYTES\r\n--XyZ--', reqHeaders: [['Content-Type', 'multipart/form-data; boundary=XyZ']] }))
    expect(mp.kind === 'rows' && mp.mode).toBe('form')
    expect(mp.kind === 'rows' && mp.rows.map((r) => [r.key, r.value, r.on])).toEqual([
      ['n', 'val', true],
      ['f', '«файл: a.xlsx» — выберите заново', false],
    ])
    expect(parseBody(rec({ postData: 'hello', reqHeaders: [['Content-Type', 'text/plain; charset=utf-8']] }))).toEqual({ kind: 'raw', text: 'hello', type: 'text/plain' })
    expect(parseBody(rec({}))).toEqual({ kind: 'none' })
  })
  it('a host as a piece of a variable name', () => {
    expect(hostKey('API.Example.com:8080')).toBe('api_example_com_8080')
  })
})

describe('the address line in parts', () => {
  it('scheme, host, path, the query by keys and values, the hash', () => {
    expect(addressParts('https://x.test/a/b?k=v&e&q=1=2#h')).toEqual([
      { t: 'https://', c: 'u-scheme' },
      { t: 'x.test', c: 'u-host' },
      { t: '/a/b', c: 'u-path' },
      { t: '?', c: 'u-sep' },
      { t: 'k', c: 'u-key' },
      { t: '=', c: 'u-sep' },
      { t: 'v', c: 'u-val' },
      { t: '&', c: 'u-sep' },
      { t: 'e', c: 'u-key' },
      { t: '&', c: 'u-sep' },
      { t: 'q', c: 'u-key' },
      { t: '=', c: 'u-sep' },
      { t: '1=2', c: 'u-val' },
      { t: '#h', c: 'u-hash' },
    ])
    expect(addressParts('just words')).toEqual([{ t: 'just words', c: 'u-path' }])
  })
})
