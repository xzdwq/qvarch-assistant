import { describe, expect, it } from 'vitest'
import { allRequests, type HttpFolder, type HttpRequest } from '../../src/shared/http'
import { importInto } from '../../src/shared/httpCollection'
import { postmanImport, urlOf } from '../../src/shared/httpPostman'
import { apiMapRecs } from '../../src/shared/browser/apiMapToRec'
import { findLinks, recordingToHttp } from '../../src/shared/browser'
import type { ApiEndpoint } from '../../src/shared/apiMap'

const V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const reqs = (f?: HttpFolder): HttpRequest[] => allRequests(f?.children ?? []).map((x) => x.req)

describe('Postman collection', () => {
  const col = {
    info: { name: 'Сервис', schema: V21 },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
    variable: [
      { key: 'baseUrl', value: 'https://api.example.test' },
      { key: 'token', value: 's3cr3t', type: 'secret' },
    ],
    item: [
      {
        name: 'Пользователи',
        item: [
          {
            name: 'Один',
            request: {
              method: 'GET',
              header: [
                { key: 'Accept', value: 'application/json' },
                { key: 'X-Off', value: '1', disabled: true },
              ],
              url: { raw: '{{baseUrl}}/users/:id?full=true&q=a%20b', host: ['{{baseUrl}}'], path: ['users', ':id'], query: [{ key: 'full', value: 'true' }, { key: 'q', value: 'a%20b' }, { key: 'off', value: 'x', disabled: true }], variable: [{ key: 'id', value: '42' }] },
            },
            event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => {})', '/* x */'] } }],
          },
          {
            name: 'Создать',
            request: {
              method: 'POST',
              auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] },
              body: { mode: 'raw', raw: '{"name":"{{name}}"}', options: { raw: { language: 'json' } } },
              url: '{{baseUrl}}/users',
            },
          },
        ],
      },
      { name: 'Форма', request: { method: 'PUT', auth: { type: 'noauth' }, body: { mode: 'formdata', formdata: [{ key: 'a', value: '1' }, { key: 'f', type: 'file', src: 'C:/x.png' }] }, url: 'http://localhost:8080/:part/upload' } },
      { name: 'Ключ', request: { method: 'GET', auth: { type: 'apikey', apikey: [{ key: 'key', value: 'k' }, { key: 'value', value: 'v' }, { key: 'in', value: 'query' }] }, url: 'https://x.test/a' } },
      { name: 'GraphQL', request: { method: 'POST', body: { mode: 'graphql', graphql: { query: '{ me { id } }', variables: '{"a":1}' } }, url: 'https://x.test/graphql' } },
      { name: 'Чужой', request: { method: 'COPY', auth: { type: 'hawk', hawk: [] }, body: { mode: 'file', file: { src: 'a.bin' } }, url: 'https://x.test/b' } },
    ],
  }
  const got = postmanImport(col)
  const [one, create, form, key, gql, odd] = reqs(got.folder)

  it('keeps the tree, names and variables (secrets secret)', () => {
    expect(got.folder?.name).toBe('Сервис')
    expect(got.folder?.children.map((n) => n.name)).toEqual(['Пользователи', 'Форма', 'Ключ', 'GraphQL', 'Чужой'])
    expect(got.vars).toEqual([
      { on: true, key: 'baseUrl', value: 'https://api.example.test' },
      { on: true, key: 'token', value: 's3cr3t', secret: true },
    ])
  })

  it('carries the address, the query (off rows off, decoded once), path variables and headers', () => {
    expect(one.url).toBe('{{baseUrl}}/users/42')
    expect(one.params).toEqual([
      { on: true, key: 'full', value: 'true' },
      { on: true, key: 'q', value: 'a b' },
      { on: false, key: 'off', value: 'x' },
    ])
    expect(one.headers).toEqual([
      { on: true, key: 'Accept', value: 'application/json' },
      { on: false, key: 'X-Off', value: '1' },
    ])
  })

  it('inherits the authorization; its own and «noauth» win', () => {
    expect(one.auth).toMatchObject({ type: 'bearer', token: '{{token}}' })
    expect(create.auth).toMatchObject({ type: 'basic', user: 'u', pass: 'p' })
    expect(form.auth.type).toBe('none')
    expect(key.params).toEqual([{ on: true, key: 'k', value: 'v' }])
  })

  it('carries the bodies: JSON, form-data (a file to pick again), GraphQL', () => {
    expect(create.body).toMatchObject({ mode: 'json', text: '{"name":"{{name}}"}' })
    expect(form.body.mode).toBe('form')
    expect(form.body.rows[0]).toEqual({ on: true, key: 'a', value: '1' })
    expect(form.body.rows[1].on).toBe(false)
    expect(JSON.parse(gql.body.text)).toEqual({ query: '{ me { id } }', variables: { a: 1 } })
  })

  it('a port is not a path variable; an unknown one becomes {{name}}', () => {
    expect(form.url).toBe('http://localhost:8080/{{part}}/upload')
  })

  it('keeps the scripts as comments and tells what did not come over', () => {
    expect(one.post.startsWith('/*')).toBe(true)
    expect(one.post).toContain('pm.test')
    expect(one.post.match(/\*\//g)).toHaveLength(1)
    expect(odd.method).toBe('GET')
    expect(odd.body.mode).toBe('none')
    expect(got.notes.join('\n')).toMatch(/COPY/)
    expect(got.notes.join('\n')).toMatch(/hawk/)
    expect(got.notes.join('\n')).toMatch(/binary/)
  })

  it('reads a v2.0 request given as an address alone and a header as text', () => {
    const r = reqs(postmanImport({ info: { name: 'old' }, item: [{ name: 'x', request: 'https://x.test/a?b=1' }, { name: 'y', request: { method: 'GET', url: 'https://x.test', header: 'A: 1\nB: two' } }] }).folder)
    expect(r[0]).toMatchObject({ method: 'GET', url: 'https://x.test/a', params: [{ on: true, key: 'b', value: '1' }] })
    expect(r[1].headers).toEqual([
      { on: true, key: 'A', value: '1' },
      { on: true, key: 'B', value: 'two' },
    ])
  })
})

describe('Postman environment and other files', () => {
  it('an environment — its variables only', () => {
    const got = postmanImport({ name: 'dev', _postman_variable_scope: 'environment', values: [{ key: 'a', value: '1', enabled: true }, { key: 'b', value: 'x', enabled: false, type: 'secret' }] })
    expect(got.folder).toBeUndefined()
    expect(got.vars).toEqual([
      { on: true, key: 'a', value: '1' },
      { on: false, key: 'b', value: 'x', secret: true },
    ])
  })
  it('a v1 collection, a dump, anything else — an error in words', () => {
    expect(() => postmanImport({ requests: [] })).toThrow(/v1/)
    expect(() => postmanImport({ collections: [] })).toThrow(/выгрузка/)
    expect(() => postmanImport([1])).toThrow()
  })
  it('an address put together from its parts', () => {
    expect(urlOf({ protocol: 'https', host: ['api', 'x', 'test'], port: '8443', path: ['v1', 'a'] }).url).toBe('https://api.x.test:8443/v1/a')
  })
})

describe('import into the collection', () => {
  it('puts the folder on top, sets variables (a secret stays secret)', () => {
    const doc = { items: [], vars: [{ on: true, key: 'a', value: 'old' }] } as Parameters<typeof importInto>[0]
    importInto(doc, { id: 'f', type: 'folder', name: 'F', children: [] }, [
      { on: true, key: 'a', value: 'new', secret: true },
      { on: false, key: 'b', value: '2' },
    ])
    expect(doc.items.map((n) => n.id)).toEqual(['f'])
    expect(doc.vars).toEqual([
      { on: true, key: 'a', value: 'new', secret: true },
      { on: false, key: 'b', value: '2' },
    ])
  })
})

describe('API map → HTTP', () => {
  const ep = (method: string, path: string, at: number, extra: Partial<ApiEndpoint['sample']> = {}): ApiEndpoint => ({
    key: `${method} x.test${path}`,
    method,
    host: 'x.test',
    path,
    count: 1,
    first: at,
    last: at,
    statuses: { 200: 1 },
    msSum: 1,
    msMax: 1,
    query: [],
    pages: {},
    req: { bodies: 0, fields: {} },
    res: { bodies: 0, fields: {} },
    sample: { at, url: `https://x.test${path}`, status: 200, ...extra },
  })
  it('the calls in the order made, with headers and body; linked as a recording', () => {
    const login = ep('POST', '/login', 2, { reqBody: '{"u":"a"}', contentType: 'application/json', resBody: '{"session":"abc123xyz"}', resHeaders: [['Content-Type', 'application/json']] })
    const me = ep('GET', '/me', 3, { reqHeaders: [['Authorization', 'Bearer abc123xyz'], ['Accept', 'application/json']] })
    const none: ApiEndpoint = { ...ep('GET', '/none', 1), sample: undefined }
    const recs = apiMapRecs([me, none, login])
    expect(recs.map((r) => r.url)).toEqual(['https://x.test/login', 'https://x.test/me'])
    expect(recs[0].reqHeaders).toEqual([['Content-Type', 'application/json']])
    expect(recs[0].mimeType).toBe('application/json')
    const out = recordingToHttp(recs, findLinks(recs), { base: true, secrets: true })
    const [a, b] = out.folder.children as HttpRequest[]
    expect(a.body.mode).toBe('json')
    expect(b.headers.some((h) => h.key === 'Accept')).toBe(true)
    expect(b.auth.type).toBe('bearer')
  })
})
