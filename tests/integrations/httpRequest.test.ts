import { describe, expect, it } from 'vitest'
import { BODY_MODES, buildHeaders, kv, newRequest, toCurl, type HttpRequest } from '../../src/shared/http'

const vars = { host: 'api.test', id: '7', tok: 'T' }
const req = (patch: Partial<HttpRequest>): HttpRequest => ({ ...newRequest('r'), url: 'https://{{host}}/x', ...patch })

describe('http request', () => {
  it('headers: own ones, then the authorization and the body type (unless set by hand)', () => {
    expect(buildHeaders(req({ auth: { type: 'bearer', token: '{{tok}}', user: '', pass: '' }, body: { mode: 'json', text: '{}', rawType: '', rows: [] } }), vars)).toEqual([
      ['Authorization', 'Bearer T'],
      ['Content-Type', 'application/json'],
    ])
    expect(buildHeaders(req({ auth: { type: 'bearer', token: '', user: '', pass: '' } }), vars)).toEqual([])
    expect(buildHeaders(req({ auth: { type: 'basic', token: '', user: 'u', pass: 'п' }, headers: [kv('content-type', 'text/x')], body: { mode: 'urlencoded', text: '', rawType: '', rows: [] } }), vars)).toEqual([
      ['content-type', 'text/x'],
      ['Authorization', `Basic ${Buffer.from('u:п').toString('base64')}`],
    ])
    expect(buildHeaders(req({ body: { mode: 'raw', text: '', rawType: 'text/csv', rows: [] } }), vars)).toEqual([['Content-Type', 'text/csv']])
    expect(buildHeaders(req({ body: { mode: 'raw', text: '', rawType: '', rows: [] } }), vars)).toEqual([])
    expect(buildHeaders(req({ body: { mode: 'form', text: '', rawType: '', rows: [kv('a', '1')] } }), vars)).toEqual([])
  })

  it('cURL by the body mode', () => {
    const rows = [kv('id', '{{id}}'), kv('off', '1', false)]
    expect(toCurl(req({ method: 'POST', body: { mode: 'raw', text: 'n={{id}}', rawType: '', rows: [] } }), vars)).toBe("curl -X POST 'https://api.test/x' \\\n  --data-raw 'n=7'")
    expect(toCurl(req({ method: 'POST', body: { mode: 'urlencoded', text: '', rawType: '', rows } }), vars)).toContain("--data-urlencode 'id=7'")
    expect(toCurl(req({ method: 'POST', body: { mode: 'form', text: '', rawType: '', rows } }), vars)).toBe("curl -X POST 'https://api.test/x' \\\n  -F 'id=7'")
    expect(toCurl(req({}), vars)).toBe("curl -X GET 'https://api.test/x'")
  })

  it('the body as sent', () => {
    const body = (mode: HttpRequest['body']['mode'], text = '', rows = [kv('a', '{{id}}'), kv('b', '2')]) => BODY_MODES[mode].encode({ mode, text, rawType: '', rows }, vars)
    expect(body('none')).toBeUndefined()
    expect(body('json', '{"id":{{id}}}')).toBe('{"id":7}')
    expect(() => body('json', '{nope')).toThrow(/^Тело — не JSON/)
    expect(body('raw', 'x{{id}}')).toBe('x7')
    expect(body('urlencoded')).toBe('a=7&b=2')
    const fd = body('form') as FormData
    expect([...fd.entries()]).toEqual([
      ['a', '7'],
      ['b', '2'],
    ])
    expect(BODY_MODES.form.ownContentType).toBe(true)
  })
})
