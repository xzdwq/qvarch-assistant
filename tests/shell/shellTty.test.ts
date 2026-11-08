import { describe, expect, it } from 'vitest'
import { launchRemoteTty, PID_MARK, takePidMark, TTY_COMMAND_MAX } from '../../src/shared/shell/shells'
import { infoMd, parseInfo } from '../../src/notebook/domain/blockInfo'

describe('a server run in a terminal (tty)', () => {
  it('the script goes in the command (stdin is the terminal), its process id first on stdout', () => {
    const r = launchRemoteTty('bash', 'sudo docker ps')
    expect(r.stdin).toBeUndefined()
    expect(r.command.startsWith("bash -c '")).toBe(true)
    expect(r.command).toContain(`echo "${PID_MARK}$$"\n`)
    expect(r.command).not.toContain('>&2')
    // stdin is not cut off: the script may read the person's answer
    expect(r.command).toContain('__qa\n')
    expect(r.command).not.toContain('</dev/null')
    expect(r.command).toContain('stty -onlcr')
  })
  it('quotes in the script and the folder survive the command line', () => {
    const r = launchRemoteTty('bash', "echo 'it''s'", "/srv/my app/it's")
    expect(r.command).toContain(`echo '\\''it'\\'''\\''s'\\''`)
    expect(r.command).toContain(`cd -- '\\''/srv/my app/it'\\''\\'\\'''\\''s'\\'' || exit 1`)
  })
  it('only bash; a script too long for one argument is an error, not a cut', () => {
    expect(() => launchRemoteTty('powershell', 'dir')).toThrow(/только для bash/)
    expect(() => launchRemoteTty('bash', 'x'.repeat(TTY_COMMAND_MAX))).toThrow(/слишком длинный/)
  })
  it('the mark is read from stdout the same way', () => {
    expect(takePidMark(`${PID_MARK}77\n[sudo] password for me: `)).toEqual({ pid: 77, rest: '[sudo] password for me: ' })
  })
  it('the info line keeps the flag', () => {
    const i = parseInfo('bash run ssh=s1 name=logs tty soft')
    expect(i.tty).toBe(true)
    expect(infoMd(i)).toBe('bash run name=logs ssh=s1 tty soft')
    expect(parseInfo('bash run ssh=s1').tty).toBeUndefined()
  })
})
