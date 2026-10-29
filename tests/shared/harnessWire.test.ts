import { describe, expect, it } from 'vitest'
import { harnessError, harnessEventOf, harnessReplyText, SseReader } from '../../src/shared/agent/harnessWire'
import { cleanProfile, headersOf, sessionHeaderOf } from '../../src/shared/agent/profiles'

describe('SseReader', () => {
  it('reads events cut anywhere, skips comments, strips \\r', () => {
    const r = new SseReader()
    expect(r.push(': keepalive\r\n\r\nda')).toEqual([])
    expect(r.push('ta: {"a":1}\r\n')).toEqual([])
    expect(r.push('\r\nevent: x.tool\ndata: 1\ndata: 2\n\n')).toEqual([{ data: '{"a":1}' }, { event: 'x.tool', data: '1\n2' }])
  })
  it('gives an event not closed by a blank line at the end', () => {
    const r = new SseReader()
    r.push('data: [DONE]')
    expect(r.end()).toEqual([{ data: '[DONE]' }])
  })
})

describe('harnessEventOf', () => {
  const chunk = (content: string) => ({ data: JSON.stringify({ choices: [{ delta: { content } }] }) })
  it('reads text, the end, an error', () => {
    expect(harnessEventOf(chunk('hi'))).toEqual({ kind: 'text', text: 'hi' })
    expect(harnessEventOf({ data: '[DONE]' })).toEqual({ kind: 'done' })
    expect(harnessEventOf({ data: '{"error":{"message":"busy"}}' })).toEqual({ kind: 'error', message: 'busy' })
    expect(harnessEventOf({ data: 'not json' })).toEqual({ kind: 'none' })
    expect(harnessEventOf({ data: '{"choices":[{"delta":{}}]}' })).toEqual({ kind: 'none' })
  })
  it('reads a tool by its harness event name, loosely', () => {
    const ev = (o: unknown) => harnessEventOf({ event: 'hermes.tool.progress', data: JSON.stringify(o) }, 'hermes.tool.progress')
    expect(ev({ tool: 'terminal', status: 'started', args: { cmd: 'ls' } })).toEqual({ kind: 'tool', phase: 'start', name: 'terminal', args: '{"cmd":"ls"}' })
    expect(ev({ name: 'terminal', status: 'completed', preview: 'a b' })).toEqual({ kind: 'tool', phase: 'done', name: 'terminal', result: 'a b' })
    expect(ev({ tool_name: 'web', state: 'error', error: 'timeout' })).toEqual({ kind: 'tool', phase: 'done', name: 'web', result: 'timeout', failed: true })
    expect(ev({ status: 'started' })).toEqual({ kind: 'none' })
    // Hermes as it is: what it runs — in `label`, the call — by its id
    expect(ev({ tool: 'terminal', emoji: '💻', label: 'echo x', toolCallId: 'c1', status: 'running' })).toEqual({ kind: 'tool', phase: 'start', name: 'terminal', id: 'c1', args: 'echo x' })
    expect(ev({ tool: 'terminal', toolCallId: 'c1', status: 'completed' })).toEqual({ kind: 'tool', phase: 'done', name: 'terminal', id: 'c1' })
  })
  it('a tool event of another harness is not read as its own; the common ones are', () => {
    expect(harnessEventOf({ event: 'hermes.tool.progress', data: '{"tool":"x","status":"started"}' })).toEqual({ kind: 'none' })
    expect(harnessEventOf({ event: 'tool.started', data: '{"tool":"x"}' })).toMatchObject({ kind: 'tool', phase: 'start', name: 'x' })
    expect(harnessEventOf({ event: 'tool.failed', data: '{"tool":"x"}' })).toMatchObject({ kind: 'tool', phase: 'done', failed: true })
  })
})

describe('harness replies and errors', () => {
  it('reads a whole answer, text or parts', () => {
    expect(harnessReplyText({ choices: [{ message: { content: 'ok' } }] })).toBe('ok')
    expect(harnessReplyText({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] })).toBe('ab')
    expect(harnessReplyText({})).toBe('')
  })
  it('says a status in words', () => {
    expect(harnessError(401, '{"error":{"message":"bad key"}}')).toBe('Агент ответил 401: ключ не подошёл (API-ключ сервера агента) — bad key')
    expect(harnessError(500, '')).toBe('Агент ответил 500: ошибка')
  })
})

describe('harness profile', () => {
  it('headers: a line each, malformed and Authorization left out', () => {
    expect(headersOf({ headers: 'X-Profile: default\r\nbad line\nAuthorization: Bearer x\n X-A :  b c ' })).toEqual({ 'X-Profile': 'default', 'X-A': 'b c' })
    expect(headersOf({})).toEqual({})
  })
  it('session header: the profile\'s, else the provider\'s; "-" — none', () => {
    expect(sessionHeaderOf({ provider: 'hermes' })).toBe('X-Hermes-Session-Id')
    expect(sessionHeaderOf({ provider: 'hermes', sessionHeader: 'X-S' })).toBe('X-S')
    expect(sessionHeaderOf({ provider: 'hermes', sessionHeader: '-' })).toBeUndefined()
    expect(sessionHeaderOf({ provider: 'harness' })).toBeUndefined()
  })
  it('kept: a bad header name dropped', () => {
    expect(cleanProfile({ provider: 'harness', sessionHeader: 'X-S', headers: 'A: b' }, 'me')).toMatchObject({ provider: 'harness', sessionHeader: 'X-S', headers: 'A: b' })
    expect(cleanProfile({ provider: 'harness', sessionHeader: 'bad header' }, 'me').sessionHeader).toBeUndefined()
  })
})
