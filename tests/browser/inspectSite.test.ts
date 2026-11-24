import { describe, expect, it } from 'vitest'
import { htmlText, renderInfo, renderLine } from '../../src/shared/browser/inspect/renderMode'
import { siteFacts, type SiteInput } from '../../src/shared/browser/inspect/siteFacts'

const base = { pageText: 1000, marks: [], cached: false, softNavs: 0, manifest: false, worker: false } as const

describe('how the page is made', () => {
  it('the server HTML text: no scripts, styles, tags', () => {
    expect(htmlText('<html><script>var a="text"</script><style>p{}</style><p>Привет&nbsp;мир</p><!-- x --></html>')).toBe('Привет мир')
  })
  it('server-drawn with a framework mark — SSR + hydration; an empty shell — CSR and an app', () => {
    const ssr = renderInfo({ ...base, serverText: 900, marks: ['nextData'] })
    expect(ssr).toMatchObject({ render: 'ssr', hydrated: true, spa: true })
    const csr = renderInfo({ ...base, serverText: 10 })
    expect(csr).toMatchObject({ render: 'csr', hydrated: false, spa: true })
    expect(renderLine(csr)).toBe('CSR (браузер) · SPA')
  })
  it('built beforehand, islands, plain pages; a PWA by its manifest and worker', () => {
    expect(renderInfo({ ...base, serverText: 900, marks: ['nextStatic', 'nextData'] }).render).toBe('ssg')
    const astro = renderInfo({ ...base, serverText: 900, marks: ['astroIsland'] })
    expect(astro).toMatchObject({ islands: true, spa: false })
    const plain = renderInfo({ ...base, serverText: 900, manifest: true, worker: true })
    expect(renderLine(plain)).toBe('SSR (сервер) · многостраничный · PWA')
    expect(renderInfo({ ...base, serverText: 900, softNavs: 3 }).spa).toBe(true)
  })
})

describe('the site facts and problems', () => {
  const input = (o: Partial<SiteInput>): SiteInput => ({ url: 'https://shop.example.test/', reqs: [], cookies: [], metrics: {}, vitals: [], errors: 0, ...o })
  it('reads the document answer: CDN, compression, the security headers missing', () => {
    const doc = { id: 'd', method: 'GET', url: 'https://shop.example.test/', type: 'Document', start: 0, end: 100, status: 200, size: 50_000, proto: 'h2', resHeaders: { 'CF-Ray': '1', Server: 'cloudflare', 'Content-Security-Policy': "frame-ancestors 'self'" } }
    const { facts, problems } = siteFacts(input({ doc, reqs: [doc] }))
    expect(facts.find((f) => f.label === 'CDN / хостинг')?.value).toBe('Cloudflare')
    const titles = problems.map((p) => p.title)
    expect(titles).toContain('HTML отдаётся без сжатия')
    expect(titles).toContain('Нет заголовка HSTS')
    expect(titles).not.toContain('Страницу можно встроить в чужой сайт')
  })
  it('the resources: failures, mixed content, heavy JS, third parties — the worst first', () => {
    const r = (id: string, url: string, type: string, size: number, extra = {}) => ({ id, method: 'GET', url, type, start: 0, end: 1, size, status: 200, ...extra })
    const { problems, facts } = siteFacts(
      input({
        reqs: [r('1', 'https://shop.example.test/app.js', 'Script', 2_000_000), r('2', 'http://cdn.other.test/x.png', 'Image', 600_000), r('3', 'https://api.example.test/v1', 'XHR', 10, { status: 500 })],
      }),
    )
    expect(problems[0].level).toBe('high')
    expect(problems.map((p) => p.title)).toEqual(expect.arrayContaining(['JavaScript весит 1.9 МБ', 'Запросов с ошибкой: 1', 'Смешанное содержимое: 1', 'Тяжёлые картинки: 1']))
    expect(facts.find((f) => f.label === 'Сторонние домены')?.value).toBe('1: cdn.other.test')
  })
  it('the cookies shown as they are, their flags checked; poor vitals told', () => {
    const { facts, problems } = siteFacts(
      input({
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.example.test', secure: false, httpOnly: false, session: true, sameSite: 'None' }],
        vitals: [{ name: 'LCP', value: 5200, rating: 'poor' }],
      }),
    )
    expect(facts.find((f) => f.group === 'Cookie')?.value).toContain('abc')
    expect(problems.map((p) => p.title)).toEqual(expect.arrayContaining(['Cookie без Secure: 1', 'Cookie SameSite=None без Secure', 'Cookie входа доступны JavaScript', 'Отрисовка главного (LCP): 5.20 с']))
  })
})
