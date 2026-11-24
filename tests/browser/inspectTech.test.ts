import { describe, expect, it } from 'vitest'
import { detectTech, parsePattern, probePlan, versionOf, type RawTech, type TechSignals } from '../../src/shared/browser/inspect/techEngine'

const cats = { '12': { name: 'JavaScript frameworks' }, '22': { name: 'Web servers' }, '18': { name: 'Web frameworks' } }
const techs: Record<string, RawTech> = {
  React: { cats: [12], js: { 'React.version': '^([\\d\\.]+)$\\;version:\\1' }, dom: { 'body > div': { properties: { _reactRootContainer: '' } } } },
  'Next.js': { cats: [18], js: { __NEXT_DATA__: '' }, headers: { 'x-powered-by': '^Next\\.js ?([0-9.]+)?\\;version:\\1' }, implies: ['React', 'Webpack'] },
  Webpack: { cats: [12] },
  Nginx: { cats: [22], headers: { server: 'nginx(?:/([\\d.]+))?\\;version:\\1' } },
  Plugin: { cats: [12], scriptSrc: ['plugin\\.js'], requires: ['jQuery'] },
  Old: { cats: [12], meta: { generator: ['^Old ([\\d.]+)\\;version:\\1\\;confidence:50'] }, excludes: ['Nginx'] },
  Vue: { cats: [12], dom: ['[data-v-app]'], html: ['<div[^>]+data-server-rendered'] },
}
const sig = (o: Partial<TechSignals>): TechSignals => ({ url: 'https://a.test/', html: '', text: '', scriptSrc: [], xhr: [], headers: {}, cookies: {}, meta: {}, js: {}, dom: {}, ...o })

describe('the site technologies by fingerprints', () => {
  it('reads a pattern with its version and confidence; a version from its template', () => {
    const p = parsePattern('^Old ([\\d.]+)\\;version:\\1\\;confidence:50')
    expect(p.confidence).toBe(50)
    expect(versionOf(p.version, p.re!.exec('Old 2.1')!)).toBe('2.1')
    expect(versionOf('\\1?next:legacy', /(x)?y/.exec('y')!)).toBe('legacy')
    expect(versionOf('\\1?next:legacy', /(x)?y/.exec('xy')!)).toBe('next')
    // a regex JS cannot compile never matches
    expect(parsePattern('(?<=x').re!.test('x')).toBe(false)
  })
  it('finds by globals, headers (any case), DOM properties; the implied come along — existing ones only', () => {
    const hits = detectTech(techs, cats, sig({ js: { __NEXT_DATA__: '', 'React.version': '18.3.1' }, headers: { 'X-Powered-By': 'Next.js 14.2.0', Server: 'nginx/1.25.3' } }))
    const by = Object.fromEntries(hits.map((h) => [h.name, h]))
    expect(by['Next.js'].version).toBe('14.2.0')
    expect(by.React.version).toBe('18.3.1')
    expect(by.Webpack.by).toEqual(['от Next.js'])
    expect(by.Nginx).toMatchObject({ version: '1.25.3', cats: ['Web servers'] })
  })
  it('drops one whose requirement is not there, and the ones another excludes; DOM selectors and HTML count', () => {
    const hits = detectTech(techs, cats, sig({ scriptSrc: ['https://cdn.test/plugin.js'], meta: { Generator: ['Old 3'] }, headers: { server: 'nginx' }, dom: { '[data-v-app]': {} } }))
    const names = hits.map((h) => h.name)
    expect(names).not.toContain('Plugin')
    expect(names).not.toContain('Nginx')
    expect(names).toContain('Vue')
    expect(hits.find((h) => h.name === 'Old')).toMatchObject({ version: '3', confidence: 50 })
  })
  it('the page is asked for every global and selector once, with the attributes / properties to read', () => {
    const plan = probePlan(techs)
    expect(plan.js).toEqual(['React.version', '__NEXT_DATA__'])
    expect(plan.dom).toEqual([{ s: 'body > div', p: ['_reactRootContainer'] }, { s: '[data-v-app]' }])
  })
})
