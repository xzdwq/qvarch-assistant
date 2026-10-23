import { describe, expect, it } from 'vitest'
import { addCall, apiMapMd, apiPath, compareSpec, isIdSeg, maskBody, headerList, maskUrl, matchOp, opOf, searchMatch, searchText, searchWords, wantsBody, type ApiCall, type ApiEndpoint } from '../src/shared/apiMap'
import type { ApiOp } from '../src/shared/openapi'

const call = (p: Partial<ApiCall>): ApiCall => ({ method: 'GET', url: 'https://app.example.com/api/items', page: 'https://app.example.com/list', status: 200, ms: 100, at: 1, ...p })
const op = (method: string, path: string, summary = ''): ApiOp => ({ id: `${method} ${path}`, method, path, summary, tag: '' })

describe('Карта API: the endpoint', () => {
  it('ids of every kind become :id, words stay', () => {
    expect(apiPath('https://h.ru/api/nest/requests/5a57b3bd-df89-4093-af09-c56052e719b9/items?b=1&a=2').path).toBe('/api/nest/requests/:id/items')
    expect(apiPath('https://h.ru/api/nest/requests/x?b=1&a=2').query).toEqual(['a', 'b'])
    expect(apiPath('https://h.ru/items/products/123').path).toBe('/items/products/:id')
    expect(isIdSeg('PRD-000123')).toBe(true)
    for (const w of ['v1', 'v2', 'items', 'oauth2', 'graphql', 'product-request']) expect(isIdSeg(w)).toBe(false)
  })
  it('GraphQL / JSON-RPC: the operation apart', () => {
    expect(opOf('/graphql', JSON.stringify({ query: 'query GetUsers { users { id } }' }))).toBe('GetUsers')
    expect(opOf('/api', JSON.stringify({ operationName: 'Save', query: 'mutation { x }' }))).toBe('Save')
    expect(opOf('/rpc', JSON.stringify({ jsonrpc: '2.0', method: 'user.get' }))).toBe('user.get')
    expect(opOf('/api/items', JSON.stringify({ name: 'x' }))).toBeUndefined()
  })
  it('calls gathered: counts, answers, pages, query keys, fields', () => {
    const m = new Map<string, ApiEndpoint>()
    addCall(m, call({ url: 'https://h.ru/api/items/1?limit=10', page: 'https://h.ru/req/7f3a9c2e-1111-2222-3333-444455556666/edit', resBody: JSON.stringify({ data: [{ id: 1, name: 'a', price: null }] }) }))
    addCall(m, call({ url: 'https://h.ru/api/items/2?offset=5', page: 'https://h.ru/list', status: 500, ms: 300, resBody: JSON.stringify({ errors: [{ message: 'x' }] }) }))
    expect(m.size).toBe(1)
    const e = [...m.values()][0]
    expect(e.key).toBe('GET h.ru/api/items/:id')
    expect(e.count).toBe(2)
    expect(e.statuses).toEqual({ '200': 1, '500': 1 })
    expect(e.query).toEqual(['limit', 'offset'])
    expect(Object.keys(e.pages)).toEqual(['/req/:id/edit', '/list'])
    expect(e.res.fields['data[].price']).toMatchObject({ types: ['null'], nulls: 1 })
    expect(e.res.fields['data[].name'].n).toBe(1)
    expect(e.res.bodies).toBe(2)
    expect(e.errSample?.status).toBe(500)
    expect(e.sample?.status).toBe(200)
  })
  it('a body that is an array, ids among keys', () => {
    const m = new Map<string, ApiEndpoint>()
    addCall(m, call({ resBody: JSON.stringify([{ id: 'a' }]) }))
    addCall(m, call({ url: 'https://h.ru/api/x', resBody: JSON.stringify({ '5a57b3bd-df89-4093-af09-c56052e719b9': { qty: 1 } }) }))
    const [a, b] = [...m.values()]
    expect(Object.keys(a.res.fields)).toEqual(['(тело)', '(тело)[]', '(тело)[].id'])
    expect(Object.keys(b.res.fields)).toEqual([':id', ':id.qty'])
  })
  it('the answer wanted: the first ones, a new status, then one in 25', () => {
    const m = new Map<string, ApiEndpoint>()
    expect(wantsBody(undefined, 200)).toBe(true)
    for (let i = 0; i < 6; i++) addCall(m, call({ resBody: '{}' }))
    const e = [...m.values()][0]
    expect(wantsBody(e, 200)).toBe(false)
    expect(wantsBody(e, 404)).toBe(true)
  })
})

describe('Карта API: secrets', () => {
  it('headers kept whole (a token too — to copy into a request), sorted, the protocol\'s own left out', () => {
    const jwt = `Bearer ${'x'.repeat(1200)}`
    const h = headerList({ Authorization: jwt, Cookie: 'sid=1', Accept: 'application/json', ':authority': 'h.ru' })!
    expect(h).toEqual([['Accept', 'application/json'], ['Authorization', jwt], ['Cookie', 'sid=1']])
    const m = new Map<string, ApiEndpoint>()
    addCall(m, { ...call({}), reqHeaders: { Authorization: 'Basic dTpw' }, resHeaders: { 'Set-Cookie': 'sid=2', 'Content-Type': 'application/json' } })
    const s = [...m.values()][0].sample!
    expect(s.reqHeaders).toEqual([['Authorization', 'Basic dTpw']])
    expect(s.resHeaders).toEqual([['Content-Type', 'application/json'], ['Set-Cookie', 'sid=2']])
    expect(headerList({})).toBeUndefined()
  })
  it('hidden in bodies (JSON, form) and the query', () => {
    expect(maskBody(JSON.stringify({ login: 'u', password: 'p', nested: { accessToken: 't' } }))).not.toMatch(/"p"|"t"/)
    expect(maskBody('username=u&password=p')).toBe('username=u&password=•••')
    expect(maskUrl('https://h.ru/a?token=abc&x=1')).toBe('https://h.ru/a?token=%E2%80%A2%E2%80%A2%E2%80%A2&x=1')
    const m = new Map<string, ApiEndpoint>()
    addCall(m, call({ method: 'POST', reqBody: JSON.stringify({ password: 'secret1' }) }))
    expect([...m.values()][0].req.fields.password.ex).toBe('•••')
  })
})

describe('Карта API: the Swagger beside it', () => {
  const ops = [op('get', '/items/{collection}'), op('get', '/items/{collection}/{id}'), op('get', '/items/products/{id}', 'Товар'), op('post', '/requests'), op('delete', '/requests/{id}')]
  it('the most literal operation; an :id is never a literal', () => {
    expect(matchOp({ method: 'GET', path: '/api/items/products/:id' }, ops, '/api')?.summary).toBe('Товар')
    expect(matchOp({ method: 'GET', path: '/api/items/orders/:id' }, ops, '/api')?.path).toBe('/items/{collection}/{id}')
    expect(matchOp({ method: 'GET', path: '/api/items/:id' }, ops, '/api')?.path).toBe('/items/{collection}')
    expect(matchOp({ method: 'POST', path: '/api/other' }, ops, '/api')).toBeUndefined()
  })
  it('the base path unknown: a literal must match somewhere', () => {
    expect(matchOp({ method: 'POST', path: '/api/nest/requests' }, ops)?.path).toBe('/requests')
    expect(matchOp({ method: 'DELETE', path: '/x/:id' }, [op('delete', '/{id}')])).toBeUndefined()
  })
  it('not in it / never called; the note', () => {
    const m = new Map<string, ApiEndpoint>()
    addCall(m, call({ url: 'https://h.ru/api/items/products/12345' }))
    addCall(m, call({ url: 'https://h.ru/api/secret/thing' }))
    const cmp = compareSpec([...m.values()], ops, '/api')
    expect(Object.keys(cmp.byKey)).toEqual(['GET h.ru/api/items/products/:id'])
    expect(cmp.notCalled.length).toBe(4)
    const md = apiMapMd('h.ru', [...m.values()], { title: 'API', ...cmp })
    expect(md).toContain('| GET | `/api/secret/thing` | 1 | 200×1 | 100 мс | /list | **нет** |')
    expect(md).toContain('## Есть в Swagger, но не вызывались')
    // (a block named by its method and address: the id is not a word)
    expect(md).toMatch(/```http name=get_products\nGET https:\/\/h\.ru\/api\/items\/products\/12345\n```/)
  })
})

describe('Карта API: the search', () => {
  const m = new Map<string, ApiEndpoint>()
  addCall(m, call({ url: 'https://app.example.com/api/nest/requests/5a57b3bd-df89-4093-af09-c56052e719b9/items?productId=1', status: 500, resBody: JSON.stringify({ uomTo: { id: '4' } }) }))
  addCall(m, call({ method: 'POST', url: 'https://app.example.com/api/items' }))
  const find = (q: string) => [...m.values()].filter((e) => searchMatch(searchText(e, e.method === 'POST' ? 'Создать товар' : ''), searchWords(q))).map((e) => e.method)
  it('an address pasted whole, real ids in it', () => {
    expect(find('https://app.example.com/api/nest/requests/5a57b3bd-df89-4093-af09-c56052e719b9/items?productId=1')).toEqual(['GET'])
    expect(find('/requests/5a57b3bd-df89-4093-af09-c56052e719b9/items')).toEqual(['GET'])
  })
  it('words — all of them: method, status, field, query key, Swagger words', () => {
    expect(find('get 500')).toEqual(['GET'])
    expect(find('uomTo')).toEqual(['GET'])
    expect(find('productid')).toEqual(['GET'])
    expect(find('товар')).toEqual(['POST'])
    expect(find('post 500')).toEqual([])
  })
})
