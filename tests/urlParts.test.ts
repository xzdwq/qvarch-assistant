import { describe, expect, it } from 'vitest'
import { buildUrl, parseUrl } from '../src/shared/urlParts'

describe('an address in parts', () => {
  const url = 'https://app.example.com:8443/items/list?search=%D0%B1%D0%BE%D0%BB%D1%82&ids=1,2&flag&page=2#top'
  it('read: scheme, host with port, path, parameters decoded, hash', () => {
    const p = parseUrl(url)
    expect(p).toMatchObject({ scheme: 'https', host: 'app.example.com:8443', path: '/items/list', hash: '#top', hashParams: [] })
    expect(p.params.map((x) => [x.key, x.value])).toEqual([['search', 'болт'], ['ids', '1,2'], ['flag', ''], ['page', '2']])
  })
  it('built back unchanged — exactly as it was (its encoding kept)', () => {
    expect(buildUrl(parseUrl(url))).toBe(url)
  })
  it('a parameter changed, turned off, added; the path and host changed', () => {
    const p = parseUrl(url)
    p.params[0].value = 'гайка М8'
    p.params[3].on = false
    p.params.push({ key: 'sort', value: 'name:asc', on: true })
    p.path = '/items/all'
    expect(buildUrl(p)).toBe('https://app.example.com:8443/items/all?search=%D0%B3%D0%B0%D0%B9%D0%BA%D0%B0%20%D0%9C8&ids=1,2&flag&sort=name:asc#top')
  })
  it('a router\'s address after #: its own parameters', () => {
    const p = parseUrl('https://h.ru/app/#/orders/5?tab=items&q=a%20b')
    expect(p.hash).toBe('#/orders/5')
    expect(p.hashParams.map((x) => [x.key, x.value])).toEqual([['tab', 'items'], ['q', 'a b']])
    p.hashParams[0].value = 'history'
    expect(buildUrl(p)).toBe('https://h.ru/app/#/orders/5?tab=history&q=a%20b')
  })
  it('all parameters off — no «?» left', () => {
    const p = parseUrl('https://h.ru/a?x=1')
    p.params[0].on = false
    expect(buildUrl(p)).toBe('https://h.ru/a')
  })
})
