import { describe, expect, it } from 'vitest'
import { cwdHookLine, HOOK_MARK, pathOfFileUrl, scanOsc7, shellQuote } from '../../src/shared/ssh/remoteShell'

describe('a server\'s shell telling its folder', () => {
  it('the hook line: out of the history, keeps the old PROMPT_COMMAND, prints the mark, ends with Enter', () => {
    const line = cwdHookLine()
    expect(line.startsWith(' ')).toBe(true)
    expect(line).toContain('${PROMPT_COMMAND:+;$PROMPT_COMMAND}')
    expect(line).toContain('precmd_functions+=(__qa_cwd)')
    expect(line).toContain(String.raw`\033]1337;QaCwdHook\007`)
    expect(line.endsWith('\r')).toBe(true)
    // (the mark itself is never in the typed line: only printf makes its ESC)
    expect(line.includes(HOOK_MARK)).toBe(false)
  })
  it('file:// URLs → paths, decoded', () => {
    expect(pathOfFileUrl('file://srv/home/u/my%20dir')).toBe('/home/u/my dir')
    expect(pathOfFileUrl('file:///var/log')).toBe('/var/log')
    expect(pathOfFileUrl('file://h/%D0%BF%D0%B0%D0%BF%D0%BA%D0%B0')).toBe('/папка')
    expect(pathOfFileUrl('http://x/y')).toBe('')
  })
  it('OSC 7 found in output, ended by BEL or ST, oldest first', () => {
    expect(scanOsc7('', 'a\x1b]7;file://h/one\x07b\x1b]7;file://h/two\x1b\\c')).toEqual({ cwds: ['/one', '/two'], carry: '' })
    expect(scanOsc7('', 'plain output')).toEqual({ cwds: [], carry: '' })
  })
  it('an OSC 7 cut between chunks is kept and finished by the next one', () => {
    const a = scanOsc7('', 'prompt\x1b]7;file://h/ho')
    expect(a).toEqual({ cwds: [], carry: '\x1b]7;file://h/ho' })
    expect(scanOsc7(a.carry, 'me/u\x07$ ')).toEqual({ cwds: ['/home/u'], carry: '' })
    const b = scanOsc7('', 'text\x1b]')
    expect(b.carry).toBe('\x1b]')
    expect(scanOsc7(b.carry, '7;file://h/x\x07').cwds).toEqual(['/x'])
    // an ESC that starts something else is not kept
    expect(scanOsc7('', 'x\x1b[').carry).toBe('')
  })
  it('a path as one shell word', () => {
    expect(shellQuote('/var/log')).toBe('/var/log')
    expect(shellQuote('/home/u/my dir')).toBe(`'/home/u/my dir'`)
    expect(shellQuote(`/a/it's`)).toBe(`'/a/it'\\''s'`)
    expect(shellQuote('/папка')).toBe(`'/папка'`)
  })
})
