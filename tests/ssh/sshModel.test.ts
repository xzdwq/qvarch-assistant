import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { cleanFolder, cleanSessionInput, sessionTree, type SshSession } from '../../src/shared/ssh/sessions'
import { baseRemote, joinRemote, localSafeName, normRemote, parentRemote, remoteCrumbs } from '../../src/shared/ssh/remotePath'
import { hostKeyVerdict, hostToken, keysOf, keyTypeOfBlob, knownHostLine } from '../../src/shared/ssh/knownHosts'
import { kindOfMode, rightsOf, sortEntries, type RemoteEntry } from '../../src/shared/ssh/remoteFiles'
import { partName, sizeText, transfersToStart, transferSpeed, trimEnded, type Transfer } from '../../src/shared/ssh/transfers'

const hmac = (salt: string, data: string) => createHmac('sha1', Buffer.from(salt, 'base64')).update(data).digest('base64')

describe('saved SSH sessions', () => {
  it('a session as sent: host and user needed, port 1…65535 (none — 22), the name defaults to user@host', () => {
    expect(cleanSessionInput({ host: ' srv.example ', user: 'root' })).toEqual({ ok: true, session: { id: '', name: 'root@srv.example', folder: '', host: 'srv.example', port: 22, user: 'root', startDir: '', followCwd: true } })
    expect(cleanSessionInput({ host: 'h', user: 'u', followCwd: false })).toMatchObject({ session: { followCwd: false } })
    expect(cleanSessionInput({ user: 'root' })).toMatchObject({ ok: false })
    expect(cleanSessionInput({ host: 'a b', user: 'root' })).toMatchObject({ ok: false })
    expect(cleanSessionInput({ host: 'h', user: '' })).toMatchObject({ ok: false })
    expect(cleanSessionInput({ host: 'h', user: 'u', port: 70000 })).toMatchObject({ ok: false })
    expect(cleanSessionInput({ host: 'h', user: 'u', port: '2222' })).toMatchObject({ ok: true, session: { port: 2222 } })
  })
  it('a password is passed on only when sent (undefined — the kept one stays)', () => {
    expect(cleanSessionInput({ host: 'h', user: 'u' })).not.toHaveProperty('session.password')
    expect(cleanSessionInput({ host: 'h', user: 'u', password: '' })).toMatchObject({ session: { password: '' } })
  })
  it('folders: parts trimmed, empty ones and either slash folded', () => {
    expect(cleanFolder(' Работа \\ Серверы//prod/ ')).toBe('Работа/Серверы/prod')
    expect(cleanFolder(undefined)).toBe('')
  })
  it('the tree: folders nested, folders and sessions sorted by name (numbers as people sort)', () => {
    const s = (id: string, name: string, folder: string): SshSession => ({ id, name, folder, host: 'h', port: 22, user: 'u', startDir: '', followCwd: true, hasPassword: false })
    const t = sessionTree([s('1', 'web10', 'A/B'), s('2', 'web2', 'A/B'), s('3', 'top', ''), s('4', 'x', 'A')])
    expect(t.sessions.map((x) => x.name)).toEqual(['top'])
    expect(t.folders[0].path).toBe('A')
    expect(t.folders[0].sessions.map((x) => x.name)).toEqual(['x'])
    expect(t.folders[0].folders[0].path).toBe('A/B')
    expect(t.folders[0].folders[0].sessions.map((x) => x.name)).toEqual(['web2', 'web10'])
  })
})

describe('paths on an SSH server', () => {
  it('made plain: one slash, dots worked out, never above the root', () => {
    expect(normRemote('//var//log/./x/../')).toBe('/var/log')
    expect(normRemote('/../..')).toBe('/')
    expect(normRemote('')).toBe('/')
    expect(normRemote('/C:/Users/../..')).toBe('/C:')
  })
  it('joined, parent, base', () => {
    expect(joinRemote('/home/u', 'a b.txt')).toBe('/home/u/a b.txt')
    expect(joinRemote('/home/u', '/etc')).toBe('/etc')
    expect(parentRemote('/home/u')).toBe('/home')
    expect(parentRemote('/')).toBe('/')
    expect(parentRemote('/C:')).toBe('/C:')
    expect(parentRemote('/C:/Users')).toBe('/C:')
    expect(baseRemote('/home/u/файл')).toBe('файл')
    expect(baseRemote('/')).toBe('')
  })
  it('crumbs: the root first; a Windows drive is its own root', () => {
    expect(remoteCrumbs('/var/log')).toEqual([
      { name: '/', path: '/' },
      { name: 'var', path: '/var' },
      { name: 'log', path: '/var/log' },
    ])
    expect(remoteCrumbs('/C:/Users')).toEqual([
      { name: 'C:', path: '/C:' },
      { name: 'Users', path: '/C:/Users' },
    ])
  })
  it('a server\'s file name a Windows disk takes', () => {
    expect(localSafeName('a:b*c?.txt')).toBe('a_b_c_.txt')
    expect(localSafeName('name. ')).toBe('name')
    expect(localSafeName('CON')).toBe('_CON')
    expect(localSafeName('con.txt')).toBe('_con.txt')
    expect(localSafeName('...')).toBe('_')
  })
})

describe('known_hosts', () => {
  const key = 'AAAAC3NzaC1lZDI1NTE5AAAAIExample'
  const other = 'AAAAC3NzaC1lZDI1NTE5AAAAIOther'
  it('the token: the name for port 22, else [name]:port', () => {
    expect(hostToken('Srv.Example', 22)).toBe('srv.example')
    expect(hostToken('srv', 2222)).toBe('[srv]:2222')
    expect(knownHostLine('srv', 2222, 'ssh-ed25519', key)).toBe(`[srv]:2222 ssh-ed25519 ${key}`)
  })
  it('plain, listed, patterned, negated and hashed hosts', () => {
    const salt = Buffer.from('0123456789abcdef0123').toString('base64')
    const text = [
      '# comment',
      `a.example,b.example ssh-ed25519 ${key}`,
      `[c.example]:2222 ssh-ed25519 ${key}`,
      `*.wild,!no.wild ssh-rsa ${other}`,
      `|1|${salt}|${hmac(salt, 'hashed.example')} ssh-ed25519 ${key}`,
      `@cert-authority *.example ssh-rsa ${other}`,
      'broken-line',
    ].join('\n')
    expect(keysOf(text, 'b.example', 22, hmac)).toEqual([{ keyType: 'ssh-ed25519', key, revoked: false }])
    expect(keysOf(text, 'c.example', 22, hmac)).toEqual([])
    expect(keysOf(text, 'c.example', 2222, hmac)).toHaveLength(1)
    expect(keysOf(text, 'x.wild', 22, hmac)).toEqual([{ keyType: 'ssh-rsa', key: other, revoked: false }])
    expect(keysOf(text, 'no.wild', 22, hmac)).toEqual([])
    expect(keysOf(text, 'hashed.example', 22, hmac)).toHaveLength(1)
    expect(keysOf(text, 'other.example', 22, hmac)).toEqual([])
  })
  it('the verdict: known, unknown, changed, revoked', () => {
    const known = [{ keyType: 'ssh-ed25519', key, revoked: false }]
    expect(hostKeyVerdict(known, 'ssh-ed25519', key)).toBe('known')
    expect(hostKeyVerdict(known, 'ssh-ed25519', other)).toBe('changed')
    expect(hostKeyVerdict(known, 'ssh-rsa', other)).toBe('unknown')
    expect(hostKeyVerdict([], 'ssh-ed25519', key)).toBe('unknown')
    expect(hostKeyVerdict([...known, { keyType: 'ssh-ed25519', key: other, revoked: true }], 'ssh-ed25519', other)).toBe('revoked')
  })
  it('a key blob\'s type', () => {
    const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 1, 7])])
    expect(keyTypeOfBlob(blob)).toBe('ssh-ed25519')
    expect(keyTypeOfBlob(Buffer.from([0, 0, 0, 200, 1]))).toBe('')
    expect(keyTypeOfBlob(Buffer.from([1]))).toBe('')
  })
})

describe('a server\'s folder', () => {
  it('kinds and rights from the mode', () => {
    expect(kindOfMode(0o040755)).toBe('dir')
    expect(kindOfMode(0o120777)).toBe('link')
    expect(kindOfMode(0o100644)).toBe('file')
    expect(rightsOf(0o755)).toBe('rwxr-xr-x')
    expect(rightsOf(0o4755)).toBe('rwsr-xr-x')
    expect(rightsOf(0o1777)).toBe('rwxrwxrwt')
    expect(rightsOf(0o2644)).toBe('rw-r-Sr--')
  })
  it('folders and links to them first, then names as people sort', () => {
    const e = (name: string, kind: RemoteEntry['kind'], toDir = false): RemoteEntry => ({ name, path: `/${name}`, kind, size: 0, mtime: 0, rights: '', toDir })
    expect(sortEntries([e('b10', 'file'), e('b2', 'file'), e('z', 'dir'), e('lnk', 'link', true), e('a', 'link')]).map((x) => x.name)).toEqual(['lnk', 'z', 'a', 'b2', 'b10'])
  })
})

describe('the transfer queue', () => {
  const t = (id: string, state: Transfer['state']): Transfer => ({ id, sessionId: 's', dir: 'up', from: 'a', to: 'b', name: id, size: 10, done: 0, state })
  it('starts as many queued ones as there are free places, oldest first', () => {
    expect(transfersToStart([t('1', 'running'), t('2', 'queued'), t('3', 'queued'), t('4', 'queued')], 3).map((x) => x.id)).toEqual(['2', '3'])
    expect(transfersToStart([t('1', 'running'), t('2', 'running'), t('3', 'queued')], 2)).toEqual([])
    expect(transfersToStart([t('1', 'failed'), t('2', 'queued')], 1).map((x) => x.id)).toEqual(['2'])
  })
  it('speed, trimming the ended ones, the .part name, sizes', () => {
    expect(transferSpeed({ done: 2000, startedAt: 1000, endedAt: 3000 })).toBe(1000)
    expect(transferSpeed({ done: 0, startedAt: 1000 })).toBe(0)
    const list = [t('1', 'done'), t('2', 'failed'), t('3', 'running'), t('4', 'cancelled')]
    expect(trimEnded(list, 2).map((x) => x.id)).toEqual(['2', '3', '4'])
    expect(partName('/a/b.txt')).toBe('/a/b.txt.part')
    expect(sizeText(0)).toBe('0 Б')
    expect(sizeText(1536)).toBe('1,5 КБ')
    expect(sizeText(12 * 1024 * 1024)).toBe('12 МБ')
  })
})
