import { describe, expect, it } from 'vitest'
import { DEFAULT_STOP_ON, stopReason, type HttpRunResult } from '../src/shared/http'

const res = (status?: number, error?: string): HttpRunResult => ({ logs: [], vars: {}, chain: [], hasResult: false, error, response: status === undefined ? undefined : { status, statusText: '', headers: [], body: '', time: 1, size: 0, url: '' } })

describe('when a chain stops', () => {
  it('by default: an error, any 4xx / 5xx', () => {
    expect(stopReason(DEFAULT_STOP_ON, res(200))).toBeUndefined()
    expect(stopReason(DEFAULT_STOP_ON, res(404))).toBe('ответ 404')
    expect(stopReason(DEFAULT_STOP_ON, res(503))).toBe('ответ 503')
    expect(stopReason(DEFAULT_STOP_ON, res(undefined, 'Прервано'))).toBe('Прервано')
  })
  it('own codes and ranges; empty — never', () => {
    expect(stopReason('401, 409', res(404))).toBeUndefined()
    expect(stopReason('401, 409', res(409))).toBe('ответ 409')
    expect(stopReason('400-404', res(403))).toBe('ответ 403')
    expect(stopReason('3xx', res(302))).toBe('ответ 302')
    expect(stopReason('', res(500, 'boom'))).toBeUndefined()
    expect(stopReason('5xx', res(undefined, 'нет ответа'))).toBeUndefined()
  })
})
