import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VaultFiles } from '../../src/main/vault/vaultFiles'
import { testDir } from '../testTemp'

describe('vault files: a note written in place', () => {
  it('writes the text and leaves nothing beside it', () => {
    const root = testDir('vault-')
    const files = new VaultFiles(root)
    files.write('Заметка.md', 'один')
    files.write('Заметка.md', 'два')
    expect(readFileSync(join(root, 'Заметка.md'), 'utf8')).toBe('два')
    expect(existsSync(join(root, 'Заметка.md.tmp'))).toBe(false)
  })
  it('a save cut short in place: the next read puts the text being saved back', () => {
    const root = testDir('vault-')
    const files = new VaultFiles(root)
    files.write('Заметка.md', 'старый текст')
    // what a crash leaves: the whole new text beside, the note itself cut
    writeFileSync(join(root, 'Заметка.md.tmp'), 'новый текст целиком')
    writeFileSync(join(root, 'Заметка.md'), 'новый те')
    files.forget('Заметка.md')
    expect(files.read('Заметка.md')).toBe('новый текст целиком')
    expect(readFileSync(join(root, 'Заметка.md'), 'utf8')).toBe('новый текст целиком')
    expect(existsSync(join(root, 'Заметка.md.tmp'))).toBe(false)
  })
})
