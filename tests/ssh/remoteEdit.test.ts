import { describe, expect, it } from 'vitest'
import { backupPath, editorLang, looksText, TEXT_EDIT_MAX } from '../../src/shared/ssh/remoteEdit'

describe('a server\'s text file edited in place', () => {
  it('the backup sits next to it, named by the moment', () => {
    expect(backupPath('/etc/app/config.yaml', new Date(2026, 10, 7, 9, 5, 3))).toBe('/etc/app/config.yaml.backup-2026-11-07_09-05-03')
  })
  it('text is told from binary: no zero bytes, valid UTF-8 (Cyrillic too)', () => {
    expect(looksText(new TextEncoder().encode('key: значение\nport: 8080\n'))).toBe(true)
    expect(looksText(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]))).toBe(false)
    expect(looksText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false)
    expect(looksText(new Uint8Array([]))).toBe(true)
  })
  it('a UTF-8 letter cut at the sample\'s end is still text', () => {
    const b = new TextEncoder().encode('ж'.repeat(10))
    expect(looksText(b.slice(0, 7))).toBe(true)
  })
  it('the highlighting by the file\'s name', () => {
    expect(editorLang('docker-compose.yml')).toBe('yaml')
    expect(editorLang('package.JSON')).toBe('json')
    expect(editorLang('deploy.sh')).toBe('bash')
    expect(editorLang('.bashrc')).toBe('bash')
    expect(editorLang('nginx.conf')).toBe('text')
    expect(editorLang('Dockerfile')).toBe('bash')
    expect(editorLang('app.ps1')).toBe('powershell')
  })
  it('files over the limit are not opened for editing', () => {
    expect(TEXT_EDIT_MAX).toBe(5 * 1024 * 1024)
  })
})
