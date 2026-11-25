import { describe, expect, it } from 'vitest'
import { cleanStderr, parseMtimeOutput, parseReadOutput, scriptCommand, SUDO_PROMPT, SUDO_RAN, sudoOutcome } from '../../src/shared/ssh/sudo'
import { accessArgs, accessDiff, cleanAccessChange, flipBit, hasBit, modeOf, octalText } from '../../src/shared/ssh/remoteAccess'

describe('a script run on a server as oneself or as root', () => {
  it('the values go as quoted arguments, never into the script', () => {
    expect(scriptCommand('cat -- "$1"', ["/a b/it's;rm -rf ~", ''], 'self')).toBe(`sh -c 'cat -- "$1"' sh '/a b/it'\\''s;rm -rf ~' ''`)
  })
  it('no password known — sudo -n (a failed sign-in is not counted); a password — on stdin with our prompt', () => {
    expect(scriptCommand('true', [], 'sudoNoPassword')).toBe(`LC_ALL=C sudo -n -- sh -c true sh`)
    expect(scriptCommand('true', [], 'sudoPassword')).toBe(`LC_ALL=C sudo -S -p '${SUDO_PROMPT}' -- sh -c true sh`)
  })
  it('what sudo said is told apart: ran, needs a password, a wrong one, refused', () => {
    expect(sudoOutcome(`${SUDO_PROMPT}${SUDO_RAN}\n`).kind).toBe('ran')
    expect(sudoOutcome('sudo: a password is required\n').kind).toBe('needsPassword')
    expect(sudoOutcome(`${SUDO_PROMPT}Sorry, try again.\n${SUDO_PROMPT}sudo: 1 incorrect password attempt\n`).kind).toBe('wrongPassword')
    expect(sudoOutcome(`${SUDO_PROMPT}user is not in the sudoers file.\n`).kind).toBe('wrongPassword')
    expect(sudoOutcome('sudo: sorry, you must have a tty to run sudo\n')).toEqual({ kind: 'refused', message: 'sudo: sorry, you must have a tty to run sudo' })
  })
  it('the errors shown without our marks', () => {
    expect(cleanStderr(`${SUDO_RAN}\ncat: /x: No such file or directory\n`)).toBe('cat: /x: No such file or directory')
  })
  it('the read output: time and size by their mark (a login script\'s lines before it skipped), then the contents', () => {
    const out = new TextEncoder().encode('Welcome to the server\nQA_READ=1732500000:14\nключ: 1\nQA_READ=x\n')
    const r = parseReadOutput(out)!
    expect(r.mtime).toBe(1732500000)
    expect(r.size).toBe(14)
    expect(new TextDecoder().decode(r.body)).toBe('ключ: 1\nQA_READ=x\n')
    expect(parseReadOutput(new TextEncoder().encode('1732500000:14\nno mark'))).toBeUndefined()
  })
  it("the save's new time by its mark, whatever the shell printed before", () => {
    expect(parseMtimeOutput('Last login: today\r\nQA_MTIME=1764081413\n')).toBe(1764081413)
    expect(parseMtimeOutput('1764081413\n')).toBeUndefined()
  })
})

describe("an entry's rights and owner changed", () => {
  it('the rights grid and octal kept in step (special bits kept)', () => {
    expect(modeOf('644')).toBe(0o644)
    expect(modeOf('0x44')).toBeUndefined()
    expect(octalText(flipBit(0o644, 6, 1))).toBe('0744')
    expect(octalText(flipBit(0o4755, 0, 1))).toBe('4754')
    expect(hasBit(0o640, 3, 4)).toBe(true)
    expect(hasBit(0o640, 0, 4)).toBe(false)
  })
  it('only what differs is sent; with everything inside — owner and group always', () => {
    const now = { octal: '0644', owner: 'root', group: 'root' }
    expect(accessDiff(now, { octal: '644', owner: 'root', group: 'root' }, false)).toEqual({})
    expect(accessDiff(now, { octal: '0664', owner: 'user@domain.loc', group: 'root' }, false)).toEqual({ mode: '0664', owner: 'user@domain.loc' })
    expect(accessDiff(now, { octal: '0644', owner: 'root', group: 'root' }, true)).toEqual({ owner: 'root', group: 'root', recursive: true })
  })
  it('a change is checked: octal rights, names that are not options, something to change', () => {
    expect(cleanAccessChange({ mode: '0755', owner: 'DOMAIN\\user', recursive: true })).toEqual({ ok: true, change: { mode: '0755', owner: 'DOMAIN\\user', recursive: true } })
    expect(cleanAccessChange({ mode: '999' }).ok).toBe(false)
    expect(cleanAccessChange({ owner: '-R' }).ok).toBe(false)
    expect(cleanAccessChange({ owner: 'a:b' }).ok).toBe(false)
    // a domain group with a space in its name
    expect(cleanAccessChange({ owner: 'user@svc.example', group: 'domain users@svc.example' })).toEqual({ ok: true, change: { owner: 'user@svc.example', group: 'domain users@svc.example' } })
    expect(cleanAccessChange({}).ok).toBe(false)
  })
  it("the script's arguments: path, mode, owner, group, recursive", () => {
    expect(accessArgs('/srv/x', { group: 'www-data', recursive: true })).toEqual(['/srv/x', '', '', 'www-data', '1'])
  })
})
