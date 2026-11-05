import { describe, expect, it } from 'vitest'
import { makeKeys, signerOf } from '../../src/main/transport/keys'
import { Bucket, checkProof, checkSignature, deviceIdOf } from '../src/auth'
import { isReaction } from '../../src/shared/transport/chat'
import { readConfig } from '../src/config'
import { pendingSteps } from '../src/migrate'
import { deviceName } from '../src/modules/core'
import { Tickets } from '../src/tickets'
import { isUuid } from '../../src/shared/transport/ids'
import { MEDIA_REL, mediaMimeOf } from '../../src/shared/transport/space'

describe('a reaction', () => {
  it('any one emoji (with its modifiers, a flag too); no words, no markup', () => {
    expect(['👍', '❤️', '👍🏽', '🧑‍💻', '🇷🇺'].map(isReaction)).toEqual([true, true, true, true, true])
    expect(['ok', 'a👍', '<b>', '', '👍'.repeat(9), 'RU'].map(isReaction)).toEqual([false, false, false, false, false, false])
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
    expect(readConfig({ DATABASE_URL: 'postgres://x' }, '1')).toEqual({ port: 3000, databaseUrl: 'postgres://x', accessCode: '', version: '1', mediaSecret: '' })
    expect(readConfig({ DATABASE_URL: 'x', QA_PORT: 'abc', QA_ACCESS_CODE: ' c ', QA_MEDIA_SECRET: 's' }, '1')).toMatchObject({ port: 3000, accessCode: 'c', mediaSecret: 's' })
  })
  it('passes: good for their space only, signed by the key (a server with the same key takes them), never forged', () => {
    const t = new Tickets('key')
    const space = '0d6b1a8e-6f4b-4c1e-9a55-2f0c0b7e9d11'
    const pass = t.issue(space, 'dev1')
    expect(t.deviceOf(pass, space)).toBe('dev1')
    expect(new Tickets('key').deviceOf(pass, space)).toBe('dev1')
    expect(new Tickets('other').deviceOf(pass, space)).toBeUndefined()
    expect(t.deviceOf(pass, '1d6b1a8e-6f4b-4c1e-9a55-2f0c0b7e9d11')).toBeUndefined()
    expect(t.deviceOf(pass.replace('dev1', 'dev2'), space)).toBeUndefined()
    expect(new Tickets('').deviceOf(new Tickets('').issue(space, 'd'), space)).toBeUndefined()
  })
})

describe('ids and media files', () => {
  it('a UUID: 8-4-4-4-12 hex digits, any case; nothing else', () => {
    expect(['0d6b1a8e-6f4b-4c1e-9a55-2f0c0b7e9d11', '0D6B1A8E-6F4B-4C1E-9A55-2F0C0B7E9D11'].map(isUuid)).toEqual([true, true])
    expect(['', '0d6b1a8e6f4b4c1e9a552f0c0b7e9d11----', '------------------------------------', 'x', 42, null].map(isUuid)).toEqual([false, false, false, false, false, false])
  })
  it('a media file: its folder and extension from one table; its type by the extension', () => {
    expect(['.images/a.png', '.images/b.JPEG', '.audio/c.webm'].map((r) => MEDIA_REL.test(r))).toEqual([true, true, true])
    expect(['.images/a.webm', '.audio/b.png', 'images/a.png', '.images/../a.png'].map((r) => MEDIA_REL.test(r))).toEqual([false, false, false, false])
    expect(['.images/b.JPG', '.audio/c.webm', '.files/x/y.txt', '.files/x/constructor'].map(mediaMimeOf)).toEqual(['image/jpeg', 'audio/webm', undefined, undefined])
  })
})
