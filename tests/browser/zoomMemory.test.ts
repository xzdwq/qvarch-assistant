import { describe, expect, it } from 'vitest'
import { cleanZoomMemory, clampDevtoolsZoom, siteZoom, withSiteZoom, zoomSite } from '../../src/shared/browser/zoom'

describe('the pages zoom remembered', () => {
  it('belongs to a site: a host (any port, any page of it), a local file, nothing for a blank page', () => {
    expect(zoomSite('https://Docs.Example.test:8443/a/b?q=1')).toBe('docs.example.test')
    expect(zoomSite('http://docs.example.test/')).toBe('docs.example.test')
    expect(zoomSite('file:///C:/x.html')).toBe('file:')
    expect(zoomSite('about:blank')).toBe('')
    expect(zoomSite('not an address')).toBe('')
  })
  it('is set for the site, the default forgotten; a site not set — the default', () => {
    let sites = withSiteZoom({}, 'https://a.test/x', 80)
    expect(sites).toEqual({ 'a.test': 80 })
    expect(siteZoom({ sites, devtools: 0 }, 'https://a.test/other')).toBe(80)
    expect(siteZoom({ sites, devtools: 0 }, 'https://b.test/')).toBe(100)
    sites = withSiteZoom(sites, 'https://a.test/', 100)
    expect(sites).toEqual({})
    // out of bounds — kept within them; no site — nothing changes
    expect(withSiteZoom({}, 'https://a.test/', 999)).toEqual({ 'a.test': 300 })
    expect(withSiteZoom({ 'a.test': 80 }, 'about:blank', 50)).toEqual({ 'a.test': 80 })
  })
  it('read from the file: anything wrong left out, the DevTools level kept within its bounds and steps', () => {
    expect(cleanZoomMemory({ sites: { 'a.test': 80, 'b.test': 'x', 'c.test': 100 }, devtools: 1.3 })).toEqual({ sites: { 'a.test': 80 }, devtools: 1.5 })
    expect(cleanZoomMemory(undefined)).toEqual({ sites: {}, devtools: 0 })
    expect(clampDevtoolsZoom(9)).toBe(4)
    expect(clampDevtoolsZoom(-0.4)).toBe(-0.5)
  })
})
