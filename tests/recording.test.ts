import { describe, expect, it } from 'vitest'
import { accessor, findLinks, recordingToHttp, toUrl, type RecFull } from '../src/shared/browser'
import type { HttpRequest } from '../src/shared/http'

const at = new Date(2026, 9, 17, 14, 5, 9).getTime()
const rec = (o: Partial<RecFull> & { url: string }): RecFull => ({ id: Math.random().toString(36), seq: 0, tabId: 't', at, method: 'GET', type: 'Fetch', reqHeaders: [], ...o })

/** A login, a list, a create, then the created one opened and changed. */
const chain: RecFull[] = [
  rec({
    method: 'POST',
    url: 'https://api.shop.test/auth/login',
    reqHeaders: [['Content-Type', 'application/json'], [':authority', 'api.shop.test'], ['Content-Length', '40'], ['Cookie', 'sid=abc123']],
    postData: '{"username":"emily","password":"pw-123"}',
    resBody: '{"accessToken":"tok-AAAA-1111","user":{"id":7}}',
  }),
  rec({
    url: 'https://api.shop.test/items?page=2&q=red%20car',
    reqHeaders: [['Authorization', 'Bearer tok-AAAA-1111'], ['Accept', 'application/json']],
    resBody: '{"items":[{"id":501,"title":"old"}],"total":1}',
  }),
  rec({
    method: 'POST',
    url: 'https://api.shop.test/items',
    reqHeaders: [['Authorization', 'Bearer tok-AAAA-1111'], ['Content-Type', 'application/json']],
    postData: '{"title":"new thing","price":250}',
    resBody: '{"data":{"id":"c9f1e2d3","title":"new thing"}}',
  }),
  rec({
    url: 'https://api.shop.test/items/c9f1e2d3',
    reqHeaders: [['Authorization', 'Bearer tok-AAAA-1111']],
    resBody: '{"id":"c9f1e2d3","title":"new thing"}',
  }),
  rec({
    method: 'PATCH',
    url: 'https://api.shop.test/items/c9f1e2d3/price',
    reqHeaders: [['Authorization', 'Bearer tok-AAAA-1111'], ['Content-Type', 'application/json'], ['X-CSRF-Token', 'csrf-zz']],
    postData: '{"itemId":"c9f1e2d3","price":300}',
  }),
]

describe('recording → HTTP', () => {
  it('links: a value an answer gave that later requests send (not one the page sent first)', () => {
    const links = findLinks(chain)
    const id = links.find((l) => l.value === 'c9f1e2d3')!
    expect(id).toMatchObject({ from: 2, path: ['data', 'id'], varName: 'id_3' })
    expect(id.uses).toEqual([
      { to: 3, where: 'path', key: 'сегмент 2' },
      { to: 4, where: 'path', key: 'сегмент 2' },
      { to: 4, where: 'body', key: 'itemId' },
    ])
    const tok = links.find((l) => l.value === 'tok-AAAA-1111')!
    expect(tok).toMatchObject({ from: 0, path: ['accessToken'], varName: 'accessToken_1' })
    // the title the page itself sent and got back is no link; 501 was never used
    expect(links.some((l) => l.value === 'new thing' || l.value === '501')).toBe(false)
    expect(accessor(['data', 'items', 0, 'my-id'])).toBe('res.json().data.items[0]["my-id"]')
  })

  it('a folder «domain hh:mm:ss», requests «N /path», the chain wired by variables', () => {
    const { folder, vars } = recordingToHttp(chain, findLinks(chain), { base: true, secrets: true })
    expect(folder.name).toBe('api.shop.test 14:05:09')
    const [login, list, create, open, patch] = folder.children as HttpRequest[]
    expect(folder.children.map((r) => r.name)).toEqual(['1 /auth/login', '2 /items?page=2&q=red%20car', '3 /items', '4 /items/c9f1e2d3', '5 /items/c9f1e2d3/price'])
    // the address via {{base_…}}, the query as params, dropped / pseudo headers gone, the cookie a secret variable
    expect(list.url).toBe('{{base_api_shop_test}}/items')
    expect(list.params).toEqual([{ on: true, key: 'page', value: '2' }, { on: true, key: 'q', value: 'red car' }])
    expect(login.headers.map((h) => h.key)).toEqual(['Content-Type', 'Cookie'])
    expect(login.headers[1].value).toBe('{{cookie_api_shop_test}}')
    expect(login.body).toMatchObject({ mode: 'json' })
    // the token comes from the login's answer
    expect(login.post).toContain("qa.set('accessToken_1', res.json().accessToken)")
    expect(list.auth).toEqual({ type: 'bearer', token: '{{accessToken_1}}', user: '', pass: '' })
    // the created id: set by the create, used in the path and the body after
    expect(create.post).toContain("qa.set('id_3', res.json().data.id)")
    expect(open.url).toBe('{{base_api_shop_test}}/items/{{id_3}}')
    expect(patch.url).toBe('{{base_api_shop_test}}/items/{{id_3}}/price')
    expect(JSON.parse(patch.body.text.replace('{{id_3}}', 'X'))).toEqual({ itemId: 'X', price: 300 })
    expect(patch.headers.find((h) => h.key === 'X-CSRF-Token')?.value).toBe('{{x_csrf_token_api_shop_test}}')
    // variables: the base plain, the secrets marked, a link starts with its recorded value
    expect(vars).toEqual(
      expect.arrayContaining([
        { on: true, key: 'base_api_shop_test', value: 'https://api.shop.test' },
        { on: true, key: 'cookie_api_shop_test', value: 'sid=abc123', secret: true },
        { on: true, key: 'x_csrf_token_api_shop_test', value: 'csrf-zz', secret: true },
        { on: true, key: 'accessToken_1', value: 'tok-AAAA-1111', secret: true },
        { on: true, key: 'id_3', value: 'c9f1e2d3' },
      ]),
    )
  })

  it('a link switched off leaves the recorded value; no options — the address and secrets as they were', () => {
    const links = findLinks(chain).map((l) => ({ ...l, on: l.value !== 'c9f1e2d3' }))
    const { folder } = recordingToHttp(chain, links, { base: false, secrets: false })
    const reqs = folder.children as HttpRequest[]
    expect(reqs[3].url).toBe('https://api.shop.test/items/c9f1e2d3')
    expect(reqs[1].headers.find((h) => h.key === 'Authorization')?.value).toBe('Bearer {{accessToken_1}}')
  })

  it('forms: urlencoded rows, multipart without its files', () => {
    const form = recordingToHttp(
      [
        rec({ method: 'POST', url: 'https://x.test/a', reqHeaders: [['Content-Type', 'application/x-www-form-urlencoded']], postData: 'a=1&b=two%20words' }),
        rec({ method: 'POST', url: 'https://x.test/b', reqHeaders: [['Content-Type', 'multipart/form-data; boundary=XX']], postData: '--XX\r\nContent-Disposition: form-data; name="title"\r\n\r\nReport\r\n--XX\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n\r\n--XX--\r\n' }),
      ],
      [],
      { base: true, secrets: true },
    ).folder.children as HttpRequest[]
    expect(form[0].body).toMatchObject({ mode: 'urlencoded', rows: [{ key: 'a', value: '1' }, { key: 'b', value: 'two words' }] })
    expect(form[1].body.mode).toBe('form')
    expect(form[1].body.rows).toEqual([{ on: true, key: 'title', value: 'Report' }, { on: false, key: 'file', value: '«файл: a.pdf» — выберите заново' }])
    expect(form[1].headers.some((h) => h.key.toLowerCase() === 'content-type')).toBe(false)
  })

  it('the address line', () => {
    expect(toUrl('example.com/a')).toBe('https://example.com/a')
    expect(toUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(toUrl('10.0.0.5:8080/x')).toBe('http://10.0.0.5:8080/x')
    expect(toUrl('как сделать')).toBe('https://www.google.com/search?q=%D0%BA%D0%B0%D0%BA%20%D1%81%D0%B4%D0%B5%D0%BB%D0%B0%D1%82%D1%8C')
  })
})
