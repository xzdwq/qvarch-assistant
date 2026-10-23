import { httpRequestText } from '../src/shared/httpBlock'
import { describe, expect, it } from 'vitest'
import { emptyOf, readSpec, serverOf, specExamples, specToHttp } from '../src/shared/openapi'
import type { HttpFolder, HttpRequest } from '../src/shared/http'

const oas3 = {
  openapi: '3.0.1',
  info: { title: 'Shop API', version: 'v2' },
  servers: [{ url: '/api/{ver}', variables: { ver: { default: 'v2' } } }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
    schemas: {
      Base: { type: 'object', properties: { id: { type: 'string', readOnly: true }, created: { type: 'string', format: 'date-time' } } },
      Item: {
        allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number' }, qty: { type: 'integer' }, active: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } }, kind: { enum: ['a', 'b'] }, parent: { $ref: '#/components/schemas/Item' } } }],
      },
    },
  },
  paths: {
    '/items': {
      get: { tags: ['items'], summary: 'List items', parameters: [{ name: 'page', in: 'query', required: true }, { name: 'q', in: 'query' }, { name: 'X-Trace', in: 'header' }] },
      post: { tags: ['items'], summary: 'Create', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } },
    },
    '/items/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true }],
      delete: { tags: ['items'], summary: 'Remove', security: [{ key: [] }] },
    },
    '/files': { post: { tags: ['files'], requestBody: { content: { 'multipart/form-data': { schema: { properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string' } } } } } } } },
  },
}

describe('OpenAPI / Swagger → HTTP', () => {
  it('lists the operations with their tags', () => {
    const s = readSpec(oas3)
    expect(s).toMatchObject({ title: 'Shop API', version: 'v2', kind: 'OpenAPI 3.0.1' })
    expect(s.ops.map((o) => o.id)).toEqual(['GET /items', 'POST /items', 'DELETE /items/{id}', 'POST /files'])
    expect(() => readSpec({ hello: 1 })).toThrow(/OpenAPI/)
  })
  it('a body from its schema: empty values, $ref / allOf resolved, a loop cut, read-only fields left out', () => {
    expect(emptyOf(oas3, { $ref: '#/components/schemas/Item' })).toEqual({ created: '', title: '', price: 0, qty: 0, active: false, tags: [], kind: '', parent: {} })
  })
  it('the server: relative to the spec, its variables by default', () => {
    expect(serverOf(oas3, 'https://shop.test/swagger/v1.json')).toBe('https://shop.test/api/v2')
    expect(serverOf({ swagger: '2.0', host: 'api.x.test', basePath: '/v1', schemes: ['https'] }, 'http://docs.x.test/swagger.json')).toBe('https://api.x.test/v1')
  })
  it('requests: {{base}}, path params as variables, params, body, auth as secrets, a folder per tag', () => {
    const { folder, vars } = specToHttp(oas3, 'https://shop.test/swagger/v1.json', ['GET /items', 'POST /items', 'DELETE /items/{id}', 'POST /files'])
    expect(folder.name).toMatch(/^Shop API v2 \d\d:\d\d:\d\d$/)
    const [items, files] = folder.children as HttpFolder[]
    expect([items.name, files.name]).toEqual(['items', 'files'])
    const [list, create, del] = items.children as HttpRequest[]
    expect(list.name).toBe('/items — List items')
    expect(list.url).toBe('{{base_shop_test}}/items')
    expect(list.params).toEqual([{ on: true, key: 'page', value: '' }, { on: false, key: 'q', value: '' }])
    expect(list.headers).toEqual([{ on: false, key: 'X-Trace', value: '' }])
    expect(list.auth).toEqual({ type: 'bearer', token: '{{token_shop_test}}', user: '', pass: '' })
    expect(JSON.parse(create.body.text)).toMatchObject({ title: '', price: 0, active: false, tags: [] })
    expect(del.url).toBe('{{base_shop_test}}/items/{{id}}')
    expect(del.headers).toEqual([{ on: true, key: 'X-Api-Key', value: '{{x_api_key_shop_test}}' }])
    expect((files.children[0] as HttpRequest).body).toMatchObject({ mode: 'form', rows: [{ key: 'file', value: '' }, { key: 'note', value: '' }] })
    expect(vars).toEqual([
      { on: true, key: 'base_shop_test', value: 'https://shop.test/api/v2' },
      { on: true, key: 'token_shop_test', value: '', secret: true },
      { on: true, key: 'x_api_key_shop_test', value: '', secret: true },
    ])
  })
  it('Swagger 2: a body parameter, a form', () => {
    const sw = {
      swagger: '2.0',
      info: { title: 'Old', version: '1' },
      host: 'old.test',
      basePath: '/v1',
      definitions: { Pet: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } } },
      paths: { '/pets': { post: { parameters: [{ in: 'body', name: 'body', schema: { $ref: '#/definitions/Pet' } }] } }, '/login': { post: { consumes: ['application/x-www-form-urlencoded'], parameters: [{ in: 'formData', name: 'user', required: true, type: 'string' }] } } },
    }
    const { folder } = specToHttp(sw, 'https://old.test/swagger.json', ['POST /pets', 'POST /login'])
    const [pets, login] = folder.children as HttpRequest[]
    expect(pets.url).toBe('{{base_old_test}}/pets')
    expect(JSON.parse(pets.body.text)).toEqual({ name: '', age: 0 })
    expect(login.body).toMatchObject({ mode: 'urlencoded', rows: [{ on: true, key: 'user', value: '' }] })
  })
})

describe('OpenAPI → HTTP with the suggested values', () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Catalog', version: 'v1' },
    servers: [{ url: 'https://api.test' }],
    components: { schemas: { SearchParams: { type: 'integer', enum: [0, 1, 2], default: 0, description: '0 = All, 1 = Semantic, 2 = Elk' }, Body: { type: 'object', properties: { name: { type: 'string', example: 'Болт' }, mode: { $ref: '#/components/schemas/SearchParams' }, qty: { type: 'integer' } } } } },
    paths: {
      '/catalog/sync/products/{kind}': {
        post: {
          parameters: [
            { name: 'SearchParams', in: 'query', schema: { $ref: '#/components/schemas/SearchParams' } },
            { name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['full', 'delta'] } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
          ],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Body' } } } },
        },
      },
    },
  }
  const id = 'POST /catalog/sync/products/{kind}'
  it('defaults, examples, the first enum value — in params, the path and the body; nothing said — blank', () => {
    const r = specToHttp(spec, 'https://api.test/swagger.json', [id], { defaults: true }).folder.children[0] as HttpRequest
    expect(r.url).toBe('{{base_api_test}}/catalog/sync/products/full')
    expect(r.params).toEqual([{ on: false, key: 'SearchParams', value: '0' }, { on: false, key: 'page', value: '' }])
    expect(JSON.parse(r.body.text)).toEqual({ name: 'Болт', mode: 0, qty: 0 })
  })
  it('optional params on; without defaults — empty as before', () => {
    const r = specToHttp(spec, 'https://api.test/swagger.json', [id], { optional: true }).folder.children[0] as HttpRequest
    expect(r.url).toBe('{{base_api_test}}/catalog/sync/products/{{kind}}')
    expect(r.params).toEqual([{ on: true, key: 'SearchParams', value: '' }, { on: true, key: 'page', value: '' }])
    expect(JSON.parse(r.body.text)).toEqual({ name: '', mode: 0, qty: 0 })
  })
})

describe('OpenAPI → requests for the notebook', () => {
  it('the server put in, the query and headers asked for, a body from the schema, a path parameter left to fill', () => {
    const [list, create, del] = specExamples(oas3, 'https://shop.test/swagger/v1.json', ['GET /items', 'POST /items', 'DELETE /items/{id}'])
    expect(list).toEqual({ method: 'GET', url: 'https://shop.test/api/v2/items?page=', headers: [] })
    expect(create.url).toBe('https://shop.test/api/v2/items')
    expect(create.contentType).toBe('application/json')
    expect(JSON.parse(create.body!)).toMatchObject({ title: '', price: 0 })
    expect(del).toEqual({ method: 'DELETE', url: 'https://shop.test/api/v2/items/{{id}}', headers: [['X-Api-Key', '{{x_api_key_shop_test}}']] })
    // and as a block: the {{id}} kept, the query laid out
    expect(httpRequestText(list)).toBe('GET https://shop.test/api/v2/items\n    ?page=')
    expect(httpRequestText(del)).toContain('DELETE https://shop.test/api/v2/items/{{id}}')
  })
})
