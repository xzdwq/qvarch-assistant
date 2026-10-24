import { describe, expect, it } from 'vitest'
import { makeKeys, signerOf } from '../../src/main/transport/keys'
import { Bucket, checkProof, checkSignature, deviceIdOf } from '../src/auth'
import { isReaction } from '../../src/shared/transport/chat'
import { readConfig } from '../src/config'
import { pendingSteps } from '../src/migrate'
import { deviceName } from '../src/modules/core'

describe('a reaction', () => {
  it('any emoji (with its modifiers); no words, no markup', () => {
    expect(['👍', '❤️', '👍🏽', '🧑‍💻', '🇷🇺'].map(isReaction)).toEqual([true, true, true, true, false])
    expect(['ok', 'a👍', '<b>', '', '👍'.repeat(9)].map(isReaction)).toEqual([false, false, false, false, false])
  })
})

describe('signing in', () => {
  it('a signature of the challenge by the key; the device — the key\'s fingerprint', () => {
    const keys = makeKeys()
    const s = signerOf(keys, () => '')
    expect(checkSignature(keys.publicKey, 'n1', s.sign('n1'))).toBe(true)
    expect(checkSignature(keys.publicKey, 'n2', s.sign('n1'))).toBe(false)
    expect(checkSignature(makeKeys().publicKey, 'n1', s.sign('n1'))).toBe(false)
    expect(checkSignature('не ключ', 'n1', s.sign('n1'))).toBe(false)
    expect(deviceIdOf(keys.publicKey)).toMatch(/^[0-9a-f]{32}$/)
    expect(deviceIdOf(keys.publicKey)).not.toBe(deviceIdOf(makeKeys().publicKey))
  })
  it('the access code proved for this challenge only; a server without a code lets anyone in', () => {
    const s = signerOf(makeKeys(), () => 'secret')
    expect(checkProof('secret', 'n1', s.proof('n1'))).toBe(true)
    expect(checkProof('secret', 'n2', s.proof('n1'))).toBe(false)
    expect(checkProof('other', 'n1', s.proof('n1'))).toBe(false)
    expect(checkProof('secret', 'n1', '')).toBe(false)
    expect(checkProof('', 'n1', '')).toBe(true)
  })
  it('a name kept trimmed and short; none — the fingerprint\'s start', () => {
    expect(deviceName('  Альфа ', 'abcdef123')).toBe('Альфа')
    expect(deviceName('', 'abcdef123')).toBe('Устройство abcdef')
    expect(deviceName('x'.repeat(200), 'a')).toHaveLength(60)
  })
})

describe('the server\'s limits and settings', () => {
  it('a bucket: a burst at once, then so many a second', () => {
    const b = new Bucket(2, 1, 0)
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false])
    expect(b.take(500)).toBe(false)
    expect(b.take(1100)).toBe(true)
  })
  it('migrations: only the steps after the last one done, numbered from 1', () => {
    expect(pendingSteps(0, ['a', 'b'])).toEqual([{ version: 1, sql: 'a' }, { version: 2, sql: 'b' }])
    expect(pendingSteps(1, ['a', 'b'])).toEqual([{ version: 2, sql: 'b' }])
    expect(pendingSteps(2, ['a', 'b'])).toEqual([])
  })
  it('the environment: the database is required, the rest has defaults', () => {
    expect(() => readConfig({}, '1')).toThrow(/DATABASE_URL/)
    expect(readConfig({ DATABASE_URL: 'postgres://x' }, '1')).toEqual({ port: 3000, databaseUrl: 'postgres://x', accessCode: '', version: '1' })
    expect(readConfig({ DATABASE_URL: 'x', QA_PORT: 'abc', QA_ACCESS_CODE: ' c ' }, '1')).toMatchObject({ port: 3000, accessCode: 'c' })
  })
})
