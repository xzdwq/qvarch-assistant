import { describe, expect, it } from 'vitest'
import { stepsFromPw } from '../../src/shared/checkBug'
import { judgeFuzz, parsePath, type FuzzResult } from '../../src/shared/fuzz'
import type { HttpNode, HttpRequest } from '../../src/shared/http'
import { emptyOf, specExamples, specToHttp } from '../../src/shared/openapi'
import { casesFor, FIELD_KINDS } from '../../src/shared/qaMatrix'

/** The rule tables of the browser context: each row of a table does what the chain it replaced did. */

const URL = 'https://api.example.test/openapi.json'
/** A spec of one operation (GET /items) with the given parameters, body and security schemes. */
function spec(op: Record<string, unknown>, schemes: Record<string, unknown> = {}) {
  return { openapi: '3.0.0', info: { title: 'T' }, servers: [{ url: '/v1' }], paths: { '/items/{id}': { post: op } }, components: { securitySchemes: schemes } }
}
const firstRequest = (s: unknown): HttpRequest => {
  const walk = (n: HttpNode): HttpRequest | undefined => (n.type === 'request' ? n : n.children.map(walk).find(Boolean))
  return walk(specToHttp(s, URL, ['POST /items/{id}']).folder)!
}

describe('openapi: the auth a security scheme means', () => {
  const auth = (scheme: Record<string, unknown>) => firstRequest(spec({ security: [{ s: [] }] }, { s: scheme }))
  it('bearer — http bearer, oauth2, OpenID Connect', () => {
    for (const s of [{ type: 'http', scheme: 'Bearer' }, { type: 'oauth2' }, { type: 'openIdConnect' }]) expect(auth(s).auth.type).toBe('bearer')
  })
  it('basic — http basic, Swagger basic', () => {
    for (const s of [{ type: 'http', scheme: 'basic' }, { type: 'basic' }]) expect(auth(s).auth.type).toBe('basic')
  })
  it('an API key in a header / the query: a row with a secret variable', () => {
    expect(auth({ type: 'apiKey', in: 'header', name: 'X-Api-Key' }).headers.map((h) => [h.key, h.value])).toEqual([['X-Api-Key', '{{x_api_key_api_example_test}}']])
    expect(auth({ type: 'apiKey', in: 'query', name: 'key' }).params.map((p) => p.key)).toEqual(['key'])
  })
  it('a scheme not filled in (a cookie key, http digest) — nothing', () => {
    for (const s of [{ type: 'apiKey', in: 'cookie', name: 'sid' }, { type: 'http', scheme: 'digest' }]) {
      const r = auth(s)
      expect(r.auth.type === 'bearer' || r.auth.type === 'basic').toBe(false)
      expect(r.headers.length + r.params.length).toBe(0)
    }
  })
})

describe('openapi: parameters by place', () => {
  const r = firstRequest(
    spec({
      parameters: [
        { name: 'q', in: 'query' },
        { name: 'X-Trace', in: 'header' },
        { name: 'Authorization', in: 'header' },
        { name: 'id', in: 'path', example: 7 },
        { name: 'sid', in: 'cookie' },
      ],
    }),
  )
  it('query and header as rows; the auth header left to the auth; a known path value in the address', () => {
    expect(r.params.map((p) => p.key)).toEqual(['q'])
    expect(r.headers.map((h) => h.key)).toEqual(['X-Trace'])
    expect(r.url).toBe('{{base_api_example_test}}/items/{{id}}')
  })
})

describe('openapi: the body as text', () => {
  it('JSON — its text and type; a form — encoded; none — no body', () => {
    const json = spec({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { n: { type: 'integer' } } } } } } })
    expect(specExamples(json, URL, ['POST /items/{id}'])[0]).toMatchObject({ body: '{\n  "n": 0\n}', contentType: 'application/json' })
    const form = spec({ requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { a: { type: 'string' } } } } } } })
    const f = specExamples(form, URL, ['POST /items/{id}'])[0]
    expect(f.contentType).toBe('application/x-www-form-urlencoded')
    expect(specExamples(spec({}), URL, ['POST /items/{id}'])[0].body).toBeUndefined()
  })
})

describe('openapi: the empty value of a type', () => {
  it('each scalar type, an enum, an unknown type', () => {
    const of = (schema: unknown) => emptyOf({}, schema)
    expect([of({ type: 'array' }), of({ type: 'integer' }), of({ type: 'number' }), of({ type: 'boolean' }), of({ type: 'string' })]).toEqual([[], 0, 0, false, ''])
    expect(of({ type: ['null', 'integer'] })).toBe(0)
    expect(of({ enum: ['a'] })).toBe('')
    expect(of({ type: 'file' })).toBeNull()
    expect(of({ type: 'constructor' })).toBeNull()
  })
})

describe('qaMatrix: the values of each kind', () => {
  it('every kind starts with the empty ones, then its own', () => {
    for (const k of FIELD_KINDS) {
      const c = casesFor(k, {}, '')
      expect(c.slice(0, 2).map((x) => x.empty)).toEqual([true, true])
      expect(c.length).toBeGreaterThan(4)
    }
  })
  it('a number: its limits first; a text: its maxlength', () => {
    expect(casesFor('number', { min: 1, max: 10 }, '5').slice(2, 4).map((c) => c.value)).toEqual(['0', '11'])
    expect(casesFor('text', { maxlength: 5 }, 'ab').find((c) => c.bad)?.value).toHaveLength(6)
  })
  it('a date in the recorded format', () => {
    expect(casesFor('date', {}, '2024-01-01')[2].value).toBe('2024-02-31')
    expect(casesFor('date', {}, '01.01.2024')[2].value).toBe('31.02.2024')
  })
})

describe('fuzz: an answer judged', () => {
  const res = (x: Partial<FuzzResult>): FuzzResult => ({ param: 'body.ids', label: 'x', value: '', status: 200, ms: 10, bytes: 10, ...x })
  const marks = (rs: FuzzResult[]) => judgeFuzz({ status: 200, ms: 10 }, rs, { params: [{ path: 'body.ids' } as never] }).marks
  it('the first rule that fits; none — fine', () => {
    expect(marks([res({ status: 0 }), res({ error: 'x', status: 500 }), res({ status: 503 }), res({ status: 404 }), res({ bytes: 0 }), res({ file: true, found: 0 }), res({})])).toEqual(['fail', 'fail', 'fail', 'warn', 'warn', 'warn', 'ok'])
  })
  it('a slow answer — at least a warning', () => {
    expect(marks([res({ ms: 99_999 }), res({ status: 500, ms: 99_999 })])).toEqual(['warn', 'fail'])
  })
})

describe('fuzz: a path parsed', () => {
  it('quoted keys, indexes, bare brackets, plain names', () => {
    expect(parsePath('body.filter["a.b"][0][x]')).toEqual(['body', 'filter', 'a.b', 0, 'x'])
    expect(parsePath('query.f[]')).toEqual(['query', 'f', ''])
  })
})

describe('checkBug: the recorded steps in words', () => {
  it('each shape by its rule; an unknown line as is', () => {
    expect(stepsFromPw(["await page.goto('https://x.test/')", "await page.getByRole('button', { name: 'Сохранить' }).dblclick()", "await page.getByLabel('Имя').fill('')", 'await foo();']).split('\n')).toEqual([
      '1. Открыть https://x.test/',
      '2. Дважды нажать «Сохранить»',
      '3. Очистить поле «Имя»',
      '4. foo()',
    ])
  })
})
