import { describe, expect, it } from 'vitest'
import type { NoteRun } from '../../src/notebook/engine/runTypes'
import { hideInBody, hideInQuery, HIDDEN, localEntry, putEntry, runEntries, scrubRun } from '../../src/notebook/engine/sharedRuns'

const note = (): NoteRun => ({
  ctx: { token: { value: 'abc', at: 5, from: 'http', block: 'login' } },
  runs: {
    login: {
      state: 'ok',
      at: 10,
      request: { method: 'POST', url: 'https://app.example.com/login', headers: [['Authorization', 'Bearer x'], ['Accept', '*/*']], body: '', missing: [] },
      response: { status: 200, statusText: 'OK', headers: [['Set-Cookie', 's=1'], ['Content-Type', 'application/json']], body: '{}', time: 1, size: 2, url: 'u' },
    },
    rows: { state: 'run', at: 11 },
    theirs: { state: 'ok', at: 3, by: 'Бета' },
  },
  loops: {},
  loaded: true,
})

describe('a run\'s secrets as the others get it', () => {
  it('a query\'s secret parameters hidden, the others kept', () => {
    expect(hideInQuery('https://app.example.com/a?token=abc&page=2&api_key=k#top')).toBe(`https://app.example.com/a?token=${HIDDEN}&page=2&api_key=${HIDDEN}#top`)
    expect(hideInQuery('https://app.example.com/a?q=1')).toBe('https://app.example.com/a?q=1')
  })
  it('a body: a JSON\'s secret fields at any depth (laid out as it was), a form\'s parameters', () => {
    expect(hideInBody('{"access_token":"t1","user":{"name":"Альфа","password":"p"},"count":3}')).toBe(`{"access_token":"${HIDDEN}","user":{"name":"Альфа","password":"${HIDDEN}"},"count":3}`)
    expect(hideInBody('{\n  "refresh_token": "t"\n}')).toBe(`{\n  "refresh_token": "${HIDDEN}"\n}`)
    expect(hideInBody('login=alpha&password=secret')).toBe(`login=alpha&password=${HIDDEN}`)
    expect(hideInBody('просто текст = не форма')).toBe('просто текст = не форма')
    expect(hideInBody('{не json')).toBe('{не json')
  })
  it('a request\'s run: its address, body and headers scrubbed together', () => {
    const r = scrubRun({ state: 'ok', at: 1, request: { method: 'POST', url: 'https://app.example.com/login?session=s', headers: [['Cookie', 'c']], body: '{"password":"p"}', missing: [] } })
    expect(JSON.stringify(r)).not.toMatch(/"p"|=s\b|"c"/)
  })
})

describe('a shared note\'s run results', () => {
  it('this device\'s ended runs and values go out, the secret headers hidden; running ones and others\' — not', () => {
    const e = runEntries(note())
    expect(Object.keys(e).sort()).toEqual(['ctx:token', 'run:login'])
    const login = e['run:login'].value as { request: { headers: string[][] }; response: { headers: string[][] } }
    expect(login.request.headers).toEqual([['Authorization', HIDDEN], ['Accept', '*/*']])
    expect(login.response.headers).toEqual([['Set-Cookie', HIDDEN], ['Content-Type', 'application/json']])
  })
  it('an entry put in as given — someone else\'s marked with who ran it, one\'s own not; null — taken away', () => {
    const n = note()
    expect(putEntry(n, 'run:login', { state: 'ok', at: 30, table: { rows: [] } }, 'Бета')).toBe(true)
    expect(n.runs.login).toMatchObject({ at: 30, by: 'Бета' })
    expect(putEntry(n, 'run:mine', { state: 'ok', at: 31 })).toBe(true)
    expect(n.runs.mine.by).toBeUndefined()
    expect(putEntry(n, 'ctx:token', null)).toBe(true)
    expect(n.ctx.token).toBeUndefined()
    expect(putEntry(n, 'bad:x', { at: 1 })).toBe(false)
    expect(localEntry(n, 'run:rows')?.state).toBe('run')
  })
})
