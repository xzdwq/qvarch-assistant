import { describe, expect, it } from 'vitest'
import { PROPS_SPLIT, PROPS_WHO_SPLIT, octalOf, parseDirSummary, parsePropsOutput, propsCommand } from '../../src/shared/ssh/remoteProps'

describe('remote props', () => {
  it('octal rights with the special bits', () => {
    expect(octalOf(0o100644)).toBe('0644')
    expect(octalOf(0o40755)).toBe('0755')
    expect(octalOf(0o104755)).toBe('4755')
  })
  it('reads stat and file output', () => {
    const r = parsePropsOutput(`root|adm|1700000000|1700000100|1234|2|regular file\n${PROPS_SPLIT}\nASCII text\n`)
    expect(r).toEqual({ owner: 'root', group: 'adm', birth: 1700000000000, ctime: 1700000100000, inode: '1234', links: 2, typeText: 'regular file', contents: 'ASCII text' })
  })
  it('an unknown birth time and names are left out', () => {
    const r = parsePropsOutput(`UNKNOWN|UNKNOWN|0|1700000100|9|1|directory\n${PROPS_SPLIT}\n`)
    expect(r.owner).toBeUndefined()
    expect(r.birth).toBeUndefined()
    expect(r.typeText).toBe('directory')
    expect(r.contents).toBeUndefined()
  })
  it("the folder's owner and group, the signed-in user and their group (names with spaces kept)", () => {
    const r = parsePropsOutput(`root|root|0|1|9|1|regular file\n${PROPS_SPLIT}\nASCII text\n${PROPS_WHO_SPLIT}\nuser@svc.example|domain users@svc.example\nuser@svc.example\ndomain users@svc.example\n`)
    expect(r).toMatchObject({ owner: 'root', contents: 'ASCII text', parentOwner: 'user@svc.example', parentGroup: 'domain users@svc.example', me: 'user@svc.example', myGroup: 'domain users@svc.example' })
    expect(parsePropsOutput(`${PROPS_SPLIT}\n${PROPS_WHO_SPLIT}\n|\n\n\n`)).toEqual({})
  })
  it('no stat (a server without a POSIX shell) — nothing added', () => {
    expect(parsePropsOutput('')).toEqual({})
    expect(parsePropsOutput("'stat' is not recognized")).toEqual({})
  })
  it('the command quotes nothing itself and keeps the split marker', () => {
    expect(propsCommand("'/a b'")).toContain("-- '/a b'")
    expect(propsCommand('/x')).toContain(PROPS_SPLIT)
  })
  it('a folder summary', () => {
    expect(parseDirSummary('4096\n12\n3\n')).toEqual({ bytes: 4096, files: 12, dirs: 3 })
    expect(parseDirSummary('du: cannot access')).toBeUndefined()
    expect(parseDirSummary('')).toBeUndefined()
  })
})
