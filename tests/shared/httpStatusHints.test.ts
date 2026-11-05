import { describe, expect, it } from 'vitest'
import { statusHint } from '../../src/shared/httpStatusHints'

describe('an answer status’s hint', () => {
  it('says what the way of the request needs, nothing for an ordinary status', () => {
    expect(statusHint(451)).toMatch(/browser=qvarch/)
    expect(statusHint(403)).toMatch(/^нет прав или вход не передан/)
    expect(statusHint(429)).toMatch(/подожди/)
    expect(statusHint(200)).toBeUndefined()
    expect(statusHint(500)).toBeUndefined()
  })
})
