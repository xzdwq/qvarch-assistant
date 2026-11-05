import { describe, expect, it } from 'vitest'
import { cleanPath, expandVars, freshEnv, parseRegExport, type RegVar } from '../../src/shared/terminalEnv'

/** hex(2): a text as the registry exports an expandable string (UTF-16LE, a zero at the end), cut over lines. */
const hex2 = (s: string) => {
  const bytes = [...Buffer.from(`${s}\0`, 'utf16le')].map((b) => b.toString(16).padStart(2, '0'))
  return `hex(2):${bytes.slice(0, 10).join(',')},\\\r\n  ${bytes.slice(10).join(',')}`
}
const vars = (o: Record<string, string | [string]>) => new Map<string, RegVar>(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? { value: v[0], expand: true } : { value: v, expand: false }]))

describe('a new shell’s environment', () => {
  it('reads a .reg export: strings with escapes, expandable strings over lines, nothing else', () => {
    const text = ['\uFEFFWindows Registry Editor Version 5.00', '', '[HKEY_CURRENT_USER\\Environment]', `"TEMP"=${hex2('%USERPROFILE%\\AppData\\Local\\Temp')}`, '"Path"="C:\\\\Tools\\\\twg\\\\bin;C:\\\\Пользователь\\\\bin"', '"N"=dword:00000001', ''].join('\r\n')
    const m = parseRegExport(text)
    expect(m.get('TEMP')).toEqual({ value: '%USERPROFILE%\\AppData\\Local\\Temp', expand: true })
    expect(m.get('Path')).toEqual({ value: 'C:\\Tools\\twg\\bin;C:\\Пользователь\\bin', expand: false })
    expect(m.has('N')).toBe(false)
  })
  it('expands %VAR% by name in any case; an unknown one stays', () => {
    expect(expandVars('%userprofile%\\x;%NOPE%', { USERPROFILE: 'C:\\U' })).toBe('C:\\U\\x;%NOPE%')
  })
  it('cleans a PATH: trimmed entries, no empty ones, no repeats (any case, a trailing slash)', () => {
    expect(cleanPath(' C:\\Windows\\system32;;C:\\A\\;c:\\a; C:\\Windows\\System32\\ ;C:\\B')).toBe('C:\\Windows\\system32;C:\\A\\;C:\\B')
  })
  it('the system’s, then the user’s over the app’s own; PATH — system then user; the app’s extras stay', () => {
    const base = { Path: 'C:\\old', USERPROFILE: 'C:\\U', APP_ONLY: '1' }
    const env = freshEnv(base, vars({ Path: ['%SystemRoot%\\system32'], SystemRoot: 'C:\\Windows', TOOL: 'm' }), vars({ PATH: ' C:\\U\\twg\\bin;%USERPROFILE%\\bin', TOOL: 'u' }))
    expect(env.Path).toBe('C:\\Windows\\system32;C:\\U\\twg\\bin;%USERPROFILE%\\bin')
    expect(Object.keys(env).filter((k) => k.toLowerCase() === 'path')).toEqual(['Path'])
    expect(env.TOOL).toBe('u')
    expect(env.APP_ONLY).toBe('1')
  })
  it('expandable user values see the system’s; nothing read — the app’s own, its PATH cleaned', () => {
    expect(freshEnv({ X: '1' }, vars({ ROOT: 'C:\\R' }), vars({ Path: ['%ROOT%\\bin'] })).Path).toBe('C:\\R\\bin')
    expect(freshEnv({ PATH: 'C:\\a; C:\\a;' }, new Map(), new Map()).PATH).toBe('C:\\a')
  })
})
