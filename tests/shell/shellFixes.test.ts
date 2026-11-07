import { describe, expect, it } from 'vitest'
import { ENV_VALUE_MAX, launchLocal, launchRemote, PID_MARK, remoteKillTree, scriptEnv, shellTemplate, takePidMark, valuesPrefix } from '../../src/shared/shell/shells'
import { OutputCollector } from '../../src/shared/shell/output'
import { shellFingerprint } from '../../src/shared/shell/trust'

const ctx: Record<string, unknown> = { name: 'x"; Remove-Item ~ ;"', n: 5, user: { email: 'a@b' } }
const resolve = (path: string) => {
  const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), ctx)
  return v === undefined ? { ok: false } : { ok: true, value: v }
}

describe('{{ values }} in a shell script go in as the shell\'s variables, never as its code', () => {
  it('each shell refers to its variable; the values are data apart from the script', () => {
    expect(shellTemplate('powershell', 'Write-Output "{{name}}"', resolve)).toEqual({ script: 'Write-Output "$env:QA_T1"', vars: { QA_T1: 'x"; Remove-Item ~ ;"' }, missing: [] })
    expect(shellTemplate('bash', 'echo {{user.email}} {{n}}', resolve)).toEqual({ script: 'echo ${QA_T1} ${QA_T2}', vars: { QA_T1: 'a@b', QA_T2: '5' }, missing: [] })
    expect(shellTemplate('cmd', 'echo {{n}}', resolve).script).toBe('echo !QA_T1!')
  })
  it('cmd turns on delayed expansion only for a script that refers to its {{ }} variables', () => {
    expect(launchLocal('cmd', 'echo !QA_T1!', {}).tempFile?.text).toBe('@echo off\r\nchcp 65001>nul\r\nsetlocal EnableDelayedExpansion\r\necho !QA_T1!')
    expect(launchLocal('cmd', 'echo hi!', {}).tempFile?.text).toBe('@echo off\r\nchcp 65001>nul\r\necho hi!')
  })
  it('the same value twice — one variable; a missing one is said', () => {
    const r = shellTemplate('bash', '{{n}} {{ n }} {{nope}}', resolve)
    expect(r.script).toBe('${QA_T1} ${QA_T1} {{nope}}')
    expect(r.missing).toEqual(['nope'])
  })
  it('only the note values a script names (QA_<name>) go to it; too big — a clear error', () => {
    expect(scriptEnv('echo $QA_n $env:QA_user', ctx, {})).toEqual({ env: { QA_n: '5', QA_user: '{"email":"a@b"}' } })
    expect(scriptEnv('echo hi', ctx, { QA_T1: 'v' })).toEqual({ env: { QA_T1: 'v' } })
    const big = scriptEnv('echo $QA_big', { big: 'x'.repeat(ENV_VALUE_MAX + 1) }, {})
    expect('error' in big && big.error).toMatch(/big/)
  })
})

describe('the values written into a server\'s script are quoted safely', () => {
  it('PowerShell doubles every single quote, the typographic ones too', () => {
    expect(valuesPrefix('powershell', { a: 'x’; calc; ‘y' })).toBe("$env:QA_a = 'x’’; calc; ‘‘y'\n")
  })
  it('cmd on a server is refused with a clear error', () => {
    expect(() => launchRemote('cmd', 'dir')).toThrow(/cmd по SSH/)
  })
})

describe('bash never reads its script from stdin', () => {
  it('on this PC — a file (its path given with forward slashes)', () => {
    expect(launchLocal('bash', 'read x; echo $x', { bash: 'C:\\b.exe' })).toEqual({ file: 'C:\\b.exe', args: [], tempFile: { name: 'block.sh', text: 'read x; echo $x', posixPath: true } })
  })
  it('on a server — a function whose stdin is cut off, its process id told first', () => {
    const r = launchRemote('bash', 'read x\necho done')
    expect(r.command).toBe('bash -s')
    expect(r.stdin).toBe(`echo "${PID_MARK}$$" >&2\n__qa() {\nread x\necho done\n}\n__qa </dev/null\n`)
  })
  it('the process id read from stderr\'s first line and taken out of it', () => {
    expect(takePidMark(`${PID_MARK}4242\nreal error\n`)).toEqual({ pid: 4242, rest: 'real error\n' })
    expect(takePidMark('plain\n')).toEqual({ rest: 'plain\n' })
    expect(remoteKillTree(4242)).toContain('4242')
  })
})

describe('the output\'s memory stays bounded', () => {
  it('a line that never ends is cut, not grown', () => {
    const c = new OutputCollector(undefined, 1000)
    for (let i = 0; i < 200; i++) c.feed('out', '\r50% '.repeat(100))
    const r = c.result(0, 1)
    expect(r.lines.join('').length).toBeLessThanOrEqual(4096 * 2)
    expect(r.truncated).toBe(true)
  })
  it('lines and matches share a budget: the oldest go', () => {
    const c = new OutputCollector({ source: '.', flags: '' }, 1000, 500)
    for (let i = 0; i < 100; i++) c.feed('out', `${'y'.repeat(48)}${String(i).padStart(2, '0')}\n`)
    const r = c.result(0, 1)
    expect(r.lines.join('').length).toBeLessThanOrEqual(500)
    expect(r.lines.at(-1)?.endsWith('99')).toBe(true)
    expect(r.matches!.length).toBe(r.lines.length)
    expect(r.truncated).toBe(true)
  })
})

describe('the fingerprint ignores what does not change what runs', () => {
  it('skip, soft, name, id, h — the same fingerprint', () => {
    const sha = (s: string) => s
    const base = shellFingerprint('n.md', 'bash run', 'ls', sha)
    expect(shellFingerprint('n.md', 'bash run skip soft name=x id=abcd1234 h=200', 'ls', sha)).toBe(base)
    expect(shellFingerprint('n.md', 'bash run ssh=s1', 'ls', sha)).not.toBe(base)
  })
})
