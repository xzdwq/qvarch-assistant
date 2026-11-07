import { describe, expect, it } from 'vitest'
import { clixmlText, launchLocal, launchRemote, shellKindOf, UTF8_PRELUDE, valuesPrefix } from '../../src/shared/shell/shells'
import { OutputCollector } from '../../src/shared/shell/output'
import { shellFingerprint, trustVerdict } from '../../src/shared/shell/trust'

const decodePs = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le')

describe('the shells a block runs', () => {
  it('languages to shells', () => {
    expect(shellKindOf('ps1')).toBe('powershell')
    expect(shellKindOf('pwsh')).toBe('powershell')
    expect(shellKindOf('bat')).toBe('cmd')
    expect(shellKindOf('sh')).toBe('bash')
    expect(shellKindOf('python')).toBeUndefined()
  })
  it('the note\'s values as each shell\'s variables, quoted; names that are not names left out', () => {
    expect(valuesPrefix('powershell', { path: "C:\\it's" })).toBe("$env:QA_path = 'C:\\it''s'\n")
    expect(valuesPrefix('bash', { n: 5, o: { a: 1 } })).toBe(`export QA_n='5'\nexport QA_o='{"a":1}'\n`)
    expect(valuesPrefix('bash', { q: "it's" })).toBe(`export QA_q='it'\\''s'\n`)
    expect(valuesPrefix('cmd', { a: 'x y' })).toBe('set "QA_a=x y"\r\n')
    expect(valuesPrefix('cmd', { 'bad-name': 1 })).toBe('')
  })
  it('PowerShell: a .ps1 (UTF-8 with a BOM) run by -File, its output UTF-8, no execution policy in the way', () => {
    const l = launchLocal('powershell', 'Write-Output "привет"', {})
    expect(l.file).toBe('powershell.exe')
    expect(l.args).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
    expect(l.tempFile).toEqual({ name: 'block.ps1', text: `\uFEFF${UTF8_PRELUDE}\r\nWrite-Output "привет"` })
    expect(launchLocal('powershell', 'x', { pwsh: 'C:\\pwsh.exe' }).file).toBe('C:\\pwsh.exe')
  })
  it('Windows PowerShell\'s CLIXML errors read as text; other stderr as it is', () => {
    const x = '#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">Get-Item : нет &quot;C:\\x&quot;_x000D__x000A_</S><S S="Error">строка:1_x000D__x000A_</S></Objs>'
    expect(clixmlText(x)).toBe('Get-Item : нет "C:\\x"\r\nстрока:1\r\n')
    expect(clixmlText('plain error\n')).toBe('plain error\n')
  })
  it('cmd switches to UTF-8 first; no bash — a clear error', () => {
    const c = launchLocal('cmd', 'dir', {})
    expect(c).toEqual({ file: 'cmd.exe', args: ['/d', '/s', '/c'], tempFile: { name: 'block.cmd', text: '@echo off\r\nchcp 65001>nul\r\ndir' } })
    expect(() => launchLocal('bash', 'ls', {})).toThrow(/bash не найден/)
  })
  it('on a server: PowerShell encoded', () => {
    const p = launchRemote('powershell', 'Get-PSDrive')
    expect(p.command.startsWith('powershell -NoProfile -NonInteractive -EncodedCommand ')).toBe(true)
    expect(decodePs(p.command.split(' ').at(-1)!)).toBe(`${UTF8_PRELUDE}Get-PSDrive`)
  })
})

describe('a shell\'s output gathered', () => {
  it('lines across chunks, CRLF; exit code → ok', () => {
    const c = new OutputCollector()
    c.feed('out', 'a\r\nb')
    c.feed('out', 'c\n')
    c.feed('err', 'e\n')
    expect(c.result(0, 5)).toEqual({ exitCode: 0, ok: true, stdout: 'a\r\nbc\n', stderr: 'e\n', lines: ['a', 'bc'], ms: 5 })
    expect(new OutputCollector().result(2, 1).ok).toBe(false)
  })
  it('the last line without a newline counts', () => {
    const c = new OutputCollector()
    c.feed('out', 'one\ntwo')
    expect(c.result(0, 1).lines).toEqual(['one', 'two'])
  })
  it('match: only the matching lines, their groups (the whole line when there are none)', () => {
    const c = new OutputCollector({ source: '(\\d+)G\\s+(\\d+)%', flags: '' })
    c.feed('out', 'Filesystem Size Use%\n/dev/sda 40G 85%\n/dev/sdb 9G 3%\n')
    const r = c.result(0, 1)
    expect(r.lines).toEqual(['/dev/sda 40G 85%', '/dev/sdb 9G 3%'])
    expect(r.matches).toEqual([
      ['40', '85'],
      ['9', '3'],
    ])
    const w = new OutputCollector({ source: 'error', flags: 'i' })
    w.feed('out', 'ok\nERROR here\n')
    expect(w.result(0, 1).matches).toEqual([['ERROR here']])
  })
  it('a flood keeps the newest part and says so', () => {
    const c = new OutputCollector(undefined, 1000)
    for (let i = 0; i < 100; i++) c.feed('out', `${'x'.repeat(98)}${i % 10}\n`)
    const r = c.result(0, 1)
    expect(r.stdout.length).toBeLessThanOrEqual(1000)
    expect(r.stdout.endsWith('9\n')).toBe(true)
    expect(r.truncated).toBe(true)
  })
})

describe('trusting a script', () => {
  const sha = (s: string) => s
  it('the fingerprint follows the body, the info line, ask=; not id= / h=', () => {
    const base = shellFingerprint('n.md', 'bash run name=a', 'ls', sha)
    expect(shellFingerprint('n.md', 'bash run name=a', 'ls -la', sha)).not.toBe(base)
    expect(shellFingerprint('n.md', 'bash run name=a ask=never', 'ls', sha)).not.toBe(base)
    expect(shellFingerprint('m.md', 'bash run name=a', 'ls', sha)).not.toBe(base)
    expect(shellFingerprint('n.md', 'bash run name=a id=abcd1234 h=300', 'ls', sha)).toBe(base)
  })
  it('always asks when told to; approved runs; anything else asks', () => {
    expect(trustVerdict('always', true)).toBe('confirm')
    expect(trustVerdict('never', true)).toBe('run')
    expect(trustVerdict('auto', true)).toBe('run')
    expect(trustVerdict('never', false)).toBe('confirm')
    expect(trustVerdict('auto', false)).toBe('confirm')
  })
})
