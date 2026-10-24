import { describe, expect, it } from 'vitest'
import type { NoteRun } from '../../src/notebook/engine/runTypes'
import { applyEntry, entriesToSend, HIDDEN, runEntries } from '../../src/notebook/engine/sharedRuns'

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

describe('a shared note\'s run results', () => {
  it('this device\'s ended runs and values go out, the secret headers hidden; running ones and others\' — not', () => {
    const e = runEntries(note())
    expect(Object.keys(e).sort()).toEqual(['ctx:token', 'run:login'])
    const login = e['run:login'].value as { request: { headers: string[][] }; response: { headers: string[][] } }
    expect(login.request.headers).toEqual([['Authorization', HIDDEN], ['Accept', '*/*']])
    expect(login.response.headers).toEqual([['Set-Cookie', HIDDEN], ['Content-Type', 'application/json']])
  })
  it('only what changed since sent goes; a result taken away — null', () => {
    const now = runEntries(note())
    const sent = new Map(Object.entries(now).map(([k, v]) => [k, JSON.stringify(v.value)]))
    expect(entriesToSend(sent, now)).toEqual({})
    sent.set('run:old', '{}')
    const n = note()
    n.runs.login.at = 20
    expect(Object.keys(entriesToSend(sent, runEntries(n))).sort()).toEqual(['run:login', 'run:old'])
    expect(entriesToSend(sent, runEntries(n))['run:old']).toBeNull()
  })
  it('someone\'s result put in (who marked); a newer one of mine or one running here stays; null — taken away', () => {
    const n = note()
    expect(applyEntry(n, 'run:login', { state: 'ok', at: 30, table: { rows: [] } }, 'Бета')).toBe(true)
    expect(n.runs.login).toMatchObject({ at: 30, by: 'Бета' })
    expect(applyEntry(n, 'run:login', { state: 'ok', at: 25 }, 'Гамма')).toBe(false)
    expect(applyEntry(n, 'run:rows', { state: 'ok', at: 99 }, 'Бета')).toBe(false)
    expect(applyEntry(n, 'ctx:token', null, 'Бета')).toBe(true)
    expect(n.ctx.token).toBeUndefined()
    expect(applyEntry(n, 'bad:x', { at: 1 }, 'Бета')).toBe(false)
  })
})
