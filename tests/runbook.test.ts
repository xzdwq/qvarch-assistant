import { describe, expect, it } from 'vitest'
import { infoMd, interpolate, parseHttpText, parseInfo, resolvePath, runKindOf } from '../src/shared/runbook'

describe('runnable notes', () => {
  it('reads a block\'s info line', () => {
    const i = parseInfo('ts run name=total timeout=60')
    expect(i).toEqual({ lang: 'ts', run: true, lib: false, name: 'total', timeout: 60 })
    expect(runKindOf(i)).toBe('code')
    expect(runKindOf(parseInfo('ts'))).toBeUndefined()
    expect(runKindOf(parseInfo('http name=login'))).toBe('http')
    expect(runKindOf(parseInfo('json name=items'))).toBe('data')
    expect(runKindOf(parseInfo('json ref=login.body'))).toBe('ref')
    expect(parseInfo('js run name=ctx').name).toBeUndefined()
    expect(infoMd(i)).toBe('ts run name=total timeout=60')
  })
  it('reads paths and fills templates', () => {
    const ctx = { login: { status: 200, body: { token: 'abc', items: [{ id: 7 }] }, headers: { 'content-type': 'json' } }, n: 3 }
    expect(resolvePath(ctx, 'login.body.items[0].id')).toEqual({ ok: true, value: 7 })
    expect(resolvePath(ctx, 'login.body.items.length').value).toBe(1)
    expect(resolvePath(ctx, 'login.headers["content-type"]').value).toBe('json')
    expect(resolvePath(ctx, 'nope.x').ok).toBe(false)
    expect(interpolate('Bearer {{ login.body.token }} {{base_url}} {{n}}', ctx)).toEqual({ text: 'Bearer abc {{base_url}} 3', missing: ['base_url'] })
    expect(interpolate('{{login.body.items}}', ctx).text).toBe('[{"id":7}]')
  })
  it('reads a .http request', () => {
    const r = parseHttpText('# логин\nPOST {{base}}/auth HTTP/1.1\nContent-Type: application/json\nX-A: 1\n\n{"u": 1}\n')
    expect(r).toEqual({ method: 'POST', url: '{{base}}/auth', headers: [['Content-Type', 'application/json'], ['X-A', '1']], body: '{"u": 1}' })
    expect(parseHttpText('https://x.ru/a').method).toBe('GET')
  })
})
