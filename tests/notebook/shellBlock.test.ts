import { describe, expect, it } from 'vitest'
import { infoMd, matchOf, parseInfo } from '../../src/notebook/domain/blockInfo'
import { shellSpec } from '../../src/notebook/blocks/shell/spec'

const detects = (info: string) => shellSpec.detect.by === 'fence' && shellSpec.detect.matches({ info: parseInfo(info), body: '' } as never)

describe('a shell block in a note', () => {
  it('its settings read from the info line and written back', () => {
    const i = parseInfo('powershell run ssh=a1b2 match=/(\\d+)%/i ask=always cwd=C:\\work name=disk timeout=60')
    expect(i).toMatchObject({ lang: 'powershell', run: true, ssh: 'a1b2', match: '/(\\d+)%/i', ask: 'always', cwd: 'C:\\work', name: 'disk', timeout: 60 })
    expect(parseInfo(infoMd(i))).toMatchObject({ ssh: 'a1b2', match: '/(\\d+)%/i', ask: 'always', cwd: 'C:\\work', name: 'disk' })
  })
  it('a bad match= or ask= is not taken', () => {
    expect(parseInfo('bash run match=(oops').match).toBeUndefined()
    expect(parseInfo('bash run match=/(/').match).toBeUndefined()
    expect(parseInfo('bash run ask=sometimes').ask).toBeUndefined()
  })
  it('match= as a pattern for the run', () => {
    expect(matchOf('/(\\d+)G/gi')).toEqual({ source: '(\\d+)G', flags: 'gi' })
    expect(matchOf(undefined)).toBeUndefined()
  })
  it('a runnable shell fence is the block; a plain one stays code', () => {
    expect(detects('bash run')).toBe(true)
    expect(detects('powershell run name=x')).toBe(true)
    expect(detects('cmd run')).toBe(true)
    expect(detects('bash')).toBe(false)
    expect(detects('js run')).toBe(false)
  })
})
