import { describe, expect, it } from 'vitest'
import { compareTexts, foldRows } from '../src/shared/textDiff'
import { b64decode, b64encode, jwtDecode, jwtEncode, jwtVerify, uuid, uuidInfo } from '../src/shared/codec'

describe('comparing texts', () => {
  it('a line put in moves nothing: only it is marked, the rest stays equal', () => {
    const a = 'one\ntwo\nthree\nfour'
    const b = 'one\nNEW\ntwo\nthree\nfour'
    const r = compareTexts(a, b)
    expect(r.stats).toEqual({ added: 1, removed: 0, changed: 0, same: false })
    expect(r.rows.map((x) => x.kind)).toEqual(['same', 'add', 'same', 'same', 'same'])
  })
  it('a line changed in place: paired, only the changed word lit', () => {
    const r = compareTexts('let total = 10\nend', 'let total = 25\nend', { mode: 'text', ignoreSpace: false, ignoreCase: false, sortKeys: false })
    expect(r.rows[0].kind).toBe('mod')
    expect(r.rows[0].l!.segs.filter((s) => s.hl).map((s) => s.t)).toEqual(['10'])
    expect(r.rows[0].r!.segs.filter((s) => s.hl).map((s) => s.t)).toEqual(['25'])
  })
  it('JSON: formatted and keys sorted — layout and key order are not changes', () => {
    const r = compareTexts('{"b":1,"a":{"y":2,"x":1}}', '{\n  "a": {"x": 1, "y": 3},\n  "b": 1\n}')
    expect(r.json).toBe(true)
    expect(r.stats).toMatchObject({ changed: 1, added: 0, removed: 0 })
    expect(r.rows.find((x) => x.kind === 'mod')!.r!.segs.map((s) => s.t).join('')).toBe('    "y": 3')
  })
  it('spaces and case can be ignored; equal texts say so', () => {
    expect(compareTexts('a  b \nC', 'a b\nc', { mode: 'text', ignoreSpace: true, ignoreCase: true, sortKeys: false }).stats.same).toBe(true)
    expect(compareTexts('x', 'x').stats.same).toBe(true)
  })
  it('long unchanged stretches fold around the changes', () => {
    const a = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const b = a.replace('line 20', 'line twenty')
    const v = foldRows(compareTexts(a, b, { mode: 'text', ignoreSpace: false, ignoreCase: false, sortKeys: false }).rows)
    expect(v.filter((x) => 'fold' in x).map((x) => ('fold' in x ? x.fold : 0))).toEqual([17, 16])
  })
})

describe('encodings', () => {
  it('base64: UTF-8 both ways, URL-safe, a bad one says why', () => {
    expect(b64encode('Привет, мир')).toBe('0J/RgNC40LLQtdGCLCDQvNC40YA=')
    expect(b64decode('0J/RgNC40LLQtdGCLCDQvNC40YA=')).toBe('Привет, мир')
    expect(b64encode('??>', true)).toBe('Pz8-')
    expect(b64decode('Pz8-')).toBe('??>')
    expect(() => b64decode('#$%')).toThrow(/не Base64/)
  })
  it('JWT: read, signed HS256 (as jwt.io), verified, a changed payload breaks the old signature', async () => {
    const t = await jwtEncode({ alg: 'HS256', typ: 'JWT' }, { sub: '1234567890', name: 'John Doe', iat: 1516239022 }, 'your-256-bit-secret')
    expect(t).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
    expect(jwtDecode(`Bearer ${t}`).payload.name).toBe('John Doe')
    expect(await jwtVerify(t, 'your-256-bit-secret')).toBe(true)
    expect(await jwtVerify(t, 'wrong')).toBe(false)
    const forged = await jwtEncode({ alg: 'HS256', typ: 'JWT' }, { sub: 'x' }, '', jwtDecode(t).signature)
    expect(await jwtVerify(forged, 'your-256-bit-secret')).toBe(false)
    expect(() => jwtDecode('a.b')).toThrow(/три части/)
  })
  it('UUID: made in each version, read back with its version, variant and time', () => {
    const at = Date.UTC(2026, 9, 18, 12, 0, 0)
    for (const v of [1, 4, 7] as const) {
      const u = uuid(v, at)
      const i = uuidInfo(u)
      expect(i).toMatchObject({ valid: true, version: v, variant: 'RFC 9562 (стандартный)' })
      if (v !== 4) expect(i.time).toBe(at)
    }
    expect(uuidInfo('{F81D4FAE-7DEC-11D0-A765-00A0C91E6BF6}')).toMatchObject({ valid: true, version: 1, canonical: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6' })
    expect(uuidInfo('00000000-0000-0000-0000-000000000000').note).toMatch(/Nil/)
    expect(uuidInfo('not-a-uuid').valid).toBe(false)
  })
})
