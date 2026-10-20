import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ clipboard: {}, net: {}, shell: {} }))
const { Vault } = await import('../src/main/vault')
const { parseBundle } = await import('../src/shared/docBundle')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const dirs: string[] = []
function vault(): InstanceType<typeof Vault> {
  const d = mkdtempSync(join(tmpdir(), 'qa-vault-'))
  dirs.push(d)
  return new Vault(d, () => undefined)
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('a document packed and unpacked', () => {
  it('carries the pictures, the shown and linked boards, the runs', () => {
    const a = vault()
    mkdirSync(join(a.root, '.images'), { recursive: true })
    writeFileSync(join(a.root, '.images', '2026-10-19-aaaa1111.png'), PNG)
    a.create('', 'folder', 'Работа')
    a.write('Работа/Схема.qboard', '{"shapes":[{"src":".images/2026-10-19-aaaa1111.png"}]}')
    a.write('Работа/Связанная.qboard', '{"shapes":[]}')
    a.write('Работа/Прогон.md', '# Прогон\n```board\npath: Работа/Схема.qboard\n```\n```board\npath: Нет такой.qboard\n```\n')
    a.setPair('Работа/Прогон.md', 'Работа/Связанная.qboard')
    a.runWrite('Работа/Прогон.md', '{"ctx":{"x":{"value":1}},"runs":{}}')
    expect(a.hasRuns('Работа/Прогон.md')).toBe(true)

    const bare = a.exportDoc('Работа/Прогон.md', false)
    expect(bare.bundle.docs.map((d) => d.key)).toEqual(['Работа/Прогон.md', 'Работа/Связанная.qboard', 'Работа/Схема.qboard'])
    expect(bare.bundle.docs[0].runs).toBeUndefined()
    expect(bare.missing).toEqual(['Нет такой.qboard'])

    const { bundle } = a.exportDoc('Работа/Прогон.md', true)
    const b = vault()
    // the same picture name, other bytes, is already there
    mkdirSync(join(b.root, '.images'), { recursive: true })
    writeFileSync(join(b.root, '.images', '2026-10-19-aaaa1111.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]))
    b.create('', 'note', 'Прогон')
    const r = b.importDoc(parseBundle(JSON.stringify(bundle)), '')
    expect(r.main).toBe('Прогон 2.md')
    const note = b.read(r.main)
    expect(note).toContain('path: Схема.qboard')
    expect(note).toContain('path: Нет такой.qboard')
    const board = b.read('Схема.qboard')
    expect(board).not.toContain('aaaa1111')
    const pic = /\.images\/[\w.-]+\.png/.exec(board)![0]
    expect(readFileSync(join(b.root, pic)).equals(PNG)).toBe(true)
    expect(b.runRead(r.main)).toContain('"x"')
    expect(b.tree().find((n) => n.path === r.main)?.pair).toBe('Связанная.qboard')
    expect(existsSync(join(b.root, 'Связанная.qboard'))).toBe(true)
  })

  it('carries a whole folder: its subfolders (empty too), its notes in place, boards from outside', () => {
    const a = vault()
    a.create('', 'folder', 'DOS-1')
    a.create('DOS-1', 'folder', 'Тесты')
    a.create('DOS-1', 'folder', 'Пустая')
    a.write('Общая.qboard', '{"shapes":[]}')
    a.write('DOS-1/Описание.md', '# Задача\n```board\npath: Общая.qboard\n```\n')
    a.write('DOS-1/Тесты/API.md', '```http name=x\nGET https://e.com\n```\n')
    const { bundle } = a.exportDoc('DOS-1', false)
    expect(bundle.root).toBe('DOS-1')
    expect(bundle.dirs?.sort()).toEqual(['Пустая', 'Тесты'])
    const back = parseBundle(JSON.stringify(bundle))

    const b = vault()
    b.create('', 'folder', 'DOS-1')
    const r = b.importDoc(back, '')
    expect(r.folder).toBe('DOS-1 2')
    expect(b.read('DOS-1 2/Тесты/API.md')).toContain('GET https://e.com')
    expect(existsSync(join(b.root, 'DOS-1 2', 'Пустая'))).toBe(true)
    // the board it showed from outside came into the folder, the note points at it there
    expect(b.read('DOS-1 2/Описание.md')).toContain('path: DOS-1 2/Общая.qboard')
  })

  it('rejects paths out of the folder', () => {
    const b = parseBundle(JSON.stringify({ format: 'qvarch-doc', version: 1, main: '', root: 'X', dirs: ['../evil', 'ok/sub', 'C:/x'], docs: [{ key: 'a.md', kind: 'note', text: '', dir: '../../up' }] }))
    expect(b.dirs).toEqual(['ok/sub'])
    expect(b.docs[0].dir).toBe('')
  })
})
