import { describe, expect, it } from 'vitest'
import { convertCron, describeCron, forParser, guessFormat, nextRuns } from '../src/shared/cron'
import { sniffEncoded, sniffMime, b64ToBytes, bytesToB64 } from '../src/shared/codec'

describe('cron', () => {
  it('reads an expression into Russian', () => {
    const t = describeCron('0 12 * * 1-6', 'crontab')
    expect(t).toMatch(/12:00/)
    expect(t.toLowerCase()).toMatch(/понедельник|пн/)
  })
  it('runs at 12:00 every day but Sunday', () => {
    const from = new Date(2026, 9, 17, 13, 0) // Saturday 13:00
    const runs = nextRuns('0 12 * * 1-6', 'crontab', 3, from)
    expect(runs.map((d) => [d.getDay(), d.getHours(), d.getMinutes()])).toEqual([
      [1, 12, 0],
      [2, 12, 0],
      [3, 12, 0],
    ])
  })
  it('knows the dialects and moves between them', () => {
    expect(guessFormat('0 12 * * 1-6')).toBe('crontab')
    expect(guessFormat('0 0 12 * * MON-SAT')).toBe('spring')
    expect(guessFormat('0 0 12 ? * 2-7')).toBe('quartz')
    expect(convertCron('0 12 * * 1-6', 'crontab', 'quartz')).toBe('0 0 12 ? * 2-7')
    expect(convertCron('0 0 12 ? * 2-7', 'quartz', 'crontab')).toBe('0 12 * * 1-6')
    expect(convertCron('30 0 12 * * 1-6', 'spring', 'quartz')).toBe('30 0 12 ? * 2-7')
    expect(forParser('0 0 12 ? * 2-7', 'quartz')).toBe('0 0 12 ? * 1-6')
    const q = nextRuns('0 0 12 ? * 2-7', 'quartz', 1, new Date(2026, 9, 17, 13, 0))
    expect(q[0].getDay()).toBe(1)
  })
  it('refuses a broken one', () => {
    expect(() => describeCron('61 * * * *', 'crontab')).toThrow()
    expect(() => forParser('* * *', 'crontab')).toThrow(/5 полей/)
  })
})

describe('what a pasted string is', () => {
  it('tells hashes by their length and other encodings', () => {
    expect(sniffEncoded('5d41402abc4b2a76b9719d911017c592')[0].algs).toEqual(['md5'])
    expect(sniffEncoded('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')[0].algs).toEqual(['sha256'])
    expect(sniffEncoded('$2b$10$abcdefghijklmnopqrstuuJ8q0p2e3h4i5j6k7l8m9n0o1p2q3r4s')[0].kind).toBe('crypt')
    expect(sniffEncoded('0J/RgNC40LLQtdGC')[0]).toMatchObject({ kind: 'base64', decoded: 'Привет' })
    expect(sniffEncoded('a%20b%2Fc')[0]).toMatchObject({ kind: 'url', decoded: 'a b/c' })
  })
  it('takes files to Base64 and back', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0])
    const b = bytesToB64(png)
    expect(sniffMime(b64ToBytes(b).bytes)?.mime).toBe('image/png')
    expect(b64ToBytes(`data:image/png;base64,${b}`).mime).toBe('image/png')
  })
})
