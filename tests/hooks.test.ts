import { describe, expect, it } from 'vitest'
import { queryRegex, resType, siteMatch } from '../src/shared/hooks'

describe('hooks', () => {
  it('match a site by host, a wildcard or an address prefix', () => {
    expect(siteMatch('app.example.com', 'https://app.example.com/general')).toBe(true)
    expect(siteMatch('app.example.com', 'https://stage.example.com/')).toBe(false)
    expect(siteMatch('*.example.com', 'https://stage.example.com/x')).toBe(true)
    expect(siteMatch('*.example.com', 'https://example.com/')).toBe(true)
    expect(siteMatch('*.example.com', 'https://evilexample.com/')).toBe(false)
    expect(siteMatch('https://site.ru/app/', 'https://site.ru/app/page')).toBe(true)
    expect(siteMatch('https://site.ru/app/', 'https://site.ru/other')).toBe(false)
    expect(siteMatch('localhost:5199', 'http://localhost:5199/dev')).toBe(true)
    expect(siteMatch('site.ru', 'file:///c:/x')).toBe(false)
  })
  it('sort the answers by type', () => {
    expect(resType('XHR')).toBe('fetch')
    expect(resType('Fetch')).toBe('fetch')
    expect(resType('Document')).toBe('document')
    expect(resType('Script')).toBe('script')
    expect(resType('Other', 'application/javascript')).toBe('script')
    expect(resType('Image')).toBe('other')
  })
  it('make a query: text escaped, a regex with its flags, errors told', () => {
    const t = queryRegex({ on: true, query: 'a.b(c)', regex: false, types: [], maxMb: 1 }) as RegExp
    expect('xxa.b(c)'.search(t)).toBe(2)
    expect('axb(c)'.search(t)).toBe(-1)
    const r = queryRegex({ on: true, query: '/token":"(\\w+)/', regex: true, types: [], maxMb: 1 }) as RegExp
    expect(r.flags).toContain('g')
    expect(typeof queryRegex({ on: true, query: '(', regex: true, types: [], maxMb: 1 })).toBe('string')
  })
})
