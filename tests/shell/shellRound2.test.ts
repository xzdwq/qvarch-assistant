import { describe, expect, it } from 'vitest'
import { OutputCollector, stripAnsi } from '../../src/shared/shell/output'
import { launchRemote, UTF8_PRELUDE } from '../../src/shared/shell/shells'
import { shellFingerprint, SHELL_ASK, trustVerdict } from '../../src/shared/shell/trust'
import { infoMd, parseInfo } from '../../src/notebook/domain/blockInfo'

describe('colour codes never reach the value', () => {
  it('ANSI sequences cut out (colours, cursor moves, titles)', () => {
    expect(stripAnsi('\x1b[32;1mMode\x1b[0m \x1b[44;1m.agents\x1b[0m')).toBe('Mode .agents')
    expect(stripAnsi('a\x1b]0;title\x07b\x1b[2Kc')).toBe('abc')
  })
  it('the collector keeps text and lines without them', () => {
    const c = new OutputCollector()
    c.feed('out', '\x1b[32;1mMode\x1b[0m\n\x1b[44;1m.agents\x1b[0m\n')
    const r = c.result(0, 1)
    expect(r.stdout).toBe('Mode\n.agents\n')
    expect(r.lines).toEqual(['Mode', '.agents'])
  })
  it('PowerShell 7 is told to print plain text (Windows PowerShell has no $PSStyle — the check keeps it quiet)', () => {
    expect(UTF8_PRELUDE).toContain("if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }")
  })
})

describe('«Разрешить всегда — даже после изменений»', () => {
  const sha = (s: string) => s
  it('is one of the modes and runs once approved', () => {
    expect(SHELL_ASK).toContain('trust')
    expect(trustVerdict('trust', true)).toBe('run')
    expect(trustVerdict('trust', false)).toBe('confirm')
  })
  it('its approval follows the block\'s line, not its body: the script may change; the line changed — asked again', () => {
    const a = shellFingerprint('n.md', 'bash run ask=trust', 'ls', sha)
    expect(shellFingerprint('n.md', 'bash run ask=trust', 'rm -rf /tmp/x', sha)).toBe(a)
    expect(shellFingerprint('n.md', 'bash run ask=trust ssh=other', 'ls', sha)).not.toBe(a)
    expect(shellFingerprint('n.md', 'bash run', 'ls', sha)).not.toBe(shellFingerprint('n.md', 'bash run', 'ls -la', sha))
  })
})

describe('the folder a script starts in', () => {
  it('on a server: bash goes there first (and stops if it is not there), PowerShell too', () => {
    expect(launchRemote('bash', 'ls', "/srv/my app/it's").stdin).toContain(`cd -- '/srv/my app/it'\\''s' || exit 1\n__qa </dev/null`)
    const ps = launchRemote('powershell', 'dir', 'C:\\Apps')
    expect(Buffer.from(ps.command.split(' ').at(-1)!, 'base64').toString('utf16le')).toContain("Set-Location -LiteralPath 'C:\\Apps' -ErrorAction Stop;")
  })
  it('in the block\'s line a folder with spaces is kept whole', () => {
    const i = parseInfo('powershell run cwd=C:\\My%20Work\\100%25')
    expect(i.cwd).toBe('C:\\My Work\\100%')
    expect(infoMd({ ...i, cwd: 'C:\\My Work\\100%' })).toContain('cwd=C:\\My%20Work\\100%25')
  })
})
