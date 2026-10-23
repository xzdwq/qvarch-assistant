import { describe, expect, it } from 'vitest'
import { carries, chainFrom, endpointOf, saveOf, upload, valuesIn } from '../src/main/runner/outcome'
import type { Exchange } from '../src/main/runner/traffic'

let n = 0
const ex = (p: Partial<Exchange> & { method: string; url: string }): Exchange => ({ i: n++, type: 'xhr', at: n, done: true, status: 200, reqHeaders: {}, ...p })
const file = { name: 'товары.xlsx', bytes: Buffer.from('PK\u0003\u0004 the xlsx bytes of a test file, long enough') }
const multipart = (name: string, bytes: Buffer) => Buffer.concat([Buffer.from(`------x\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`), bytes, Buffer.from('\r\n------x--')])

describe('outcome: what a run per file rests on', () => {
  const sentry = ex({ method: 'POST', url: 'https://app.example.com/api/10/envelope/?sentry_key=1', body: '{"event":1}', bytes: Buffer.from('{"event":1}'), res: '{"id":"abc123def"}' })
  const poll = ex({ method: 'POST', url: 'https://app.example.com/api/track', body: '{}', bytes: Buffer.from('{}') })
  const up = ex({ method: 'POST', url: 'https://app.example.com/api/files', bytes: multipart('товары.xlsx', file.bytes), res: '{"id":"7638aee95845468cbfc478c01fcf24fc"}' })
  const parse = ex({ method: 'GET', url: 'https://app.example.com/api/import/7638aee95845468cbfc478c01fcf24fc/rows', res: '{"rows":[1,2]}' })
  const save = ex({ method: 'POST', url: 'https://app.example.com/api/import/save', body: '{"fileId":"7638aee95845468cbfc478c01fcf24fc"}', bytes: Buffer.from('{"fileId":"7638aee95845468cbfc478c01fcf24fc"}'), status: 400, res: '{"message":"Пустое имя"}' })
  const run = [sentry, poll, up, parse, save]
  it('the request carrying the file — by its name in multipart, or by its bytes', () => {
    expect(carries(up, file)).toBe(true)
    expect(carries(ex({ method: 'PUT', url: 'https://x/raw', bytes: file.bytes }), file)).toBe(true)
    expect(carries(sentry, file)).toBe(false)
  })
  it('the upload and the requests using what it gave — no list of services, no noise', () => {
    expect(upload(file).pick(run)).toEqual([up, parse, save])
    expect(chainFrom(run, [])).toEqual([])
  })
  it('the request seen while recording — by its endpoint', () => {
    expect(endpointOf(parse)).toBe('GET /api/import/:id/rows')
    expect(upload(file, 'POST /api/files').pick(run)).toEqual([up, parse, save])
    expect(upload(file, 'POST /api/other').pick(run)).toEqual([])
  })
})

describe('outcome: a form\'s save — the request carrying what was typed', () => {
  const noise = [
    { line: 'POST /api/auth/refresh → 200', body: undefined, status: 200 },
    { line: 'PATCH /api/users/me/track/page → 204', body: '{"page":"/items"}', status: 204 },
    { line: 'POST /api/10/envelope/ → 200', body: '{"event_id":"e1"}\n{"type":"event"}', status: 200 },
  ]
  it('the page\'s other changes (a token, page tracking, an error report) are no save', () => {
    expect(saveOf(noise, ['Болт М8', '123уйцуку'])).toBeUndefined()
  })
  it('the save found in JSON, in a form, in multipart; the one carrying the most values wins', () => {
    const json = { line: 'PUT /api/items/:id → 200', body: '{"name":"Болт М8","code":"123уйцуку","qty":5}', status: 200 }
    const form = { line: 'POST /api/form → 200', body: 'name=%D0%91%D0%BE%D0%BB%D1%82+%D0%9C8&x=1', status: 200 }
    const partial = { line: 'POST /api/log → 200', body: '{"msg":"Болт М8 saved"}', status: 200 }
    expect(saveOf([...noise, json, partial], ['Болт М8', '123уйцуку'])).toBe(json)
    expect(saveOf([...noise, form], ['Болт М8'])).toBe(form)
    expect(valuesIn('Content-Disposition: form-data; name="name"\r\n\r\nБолт М8\r\n', ['Болт М8'])).toBe(1)
    expect(valuesIn('{"note":"say \\"hi\\""}', ['say "hi"'])).toBe(1)
  })
})
