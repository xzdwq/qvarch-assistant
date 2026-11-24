import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PresetNotes } from '../../src/main/terminal/presetNotes'
import { presetScriptFile } from '../../src/main/terminal/presetScriptFile'
import { renderPreset } from '../../src/main/terminal/presetVariables'
import { psQuote, SCRIPT_PRESET_CMD } from '../../src/shared/terminal'
import { presetToKeep } from '../../src/shared/terminalEdit'
import { notesByRef, type VaultNode } from '../../src/shared/vault'
import { testDir } from '../testTemp'

describe('a preset with its own script', () => {
  it('the script → a .ps1 named by its text, UTF-8 with a BOM, CRLF', () => {
    const dir = testDir('preset-script-')
    const a = presetScriptFile('Write-Host "Привет"\n$x = 1', dir)
    expect(a).toMatch(/\.ps1$/)
    expect(presetScriptFile('Write-Host "Привет"\r\n$x = 1', dir)).toBe(a)
    expect(presetScriptFile('Write-Host 2', dir)).not.toBe(a)
    const bytes = readFileSync(a)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.toString('utf8').slice(1)).toBe('Write-Host "Привет"\r\n$x = 1')
  })
  it('{{ script }} in the command is its file; without a script — an error', () => {
    const src = { cwd: 'C:\\', vars: [], shell: 'powershell.exe' }
    const { text } = renderPreset(src, SCRIPT_PRESET_CMD, {}, 'Write-Host 1')
    expect(text).toMatch(/^powershell -NoProfile -ExecutionPolicy Bypass -File '.+\.ps1'$/)
    expect(() => renderPreset(src, '{{ script }}', {})).toThrow(/script/)
    expect(renderPreset(src, 'npm run script', {}).text).toBe('npm run script')
  })
  it('kept: a blank script dropped, a script alone gets the run command, a name by the command', () => {
    const base = { id: '1', name: '', cmd: '', run: true }
    expect(presetToKeep(base)).toBeUndefined()
    expect(presetToKeep({ ...base, script: '  ' })).toBeUndefined()
    expect(presetToKeep({ ...base, script: 'x' })).toMatchObject({ cmd: SCRIPT_PRESET_CMD, script: 'x', name: SCRIPT_PRESET_CMD.slice(0, 40) })
    const kept = presetToKeep({ ...base, name: 'a', cmd: 'ls', script: '\n' })
    expect(kept).toEqual({ id: '1', name: 'a', cmd: 'ls', run: true })
  })
})

const files = ['Список.md', 'Проект/Список.md', 'Проект/План.md', 'Другое.md']

describe('a note by reference', () => {
  it('a path names one note (case, ".md" and "\\" do not matter)', () => {
    expect(notesByRef('проект/список', files)).toEqual(['Проект/Список.md'])
    expect(notesByRef('Проект\\План.md', files)).toEqual(['Проект/План.md'])
    expect(notesByRef('/Другое', files)).toEqual(['Другое.md'])
  })
  it('a path at the top wins over the same name deeper', () => {
    expect(notesByRef('Список', files)).toEqual(['Список.md'])
  })
  it('a name finds every note so named; a missing path — none', () => {
    expect(notesByRef('План', files)).toEqual(['Проект/План.md'])
    expect(notesByRef('x', ['a/x.md', 'b/x.md'])).toEqual(['a/x.md', 'b/x.md'])
    expect(notesByRef('Нет/План', files)).toEqual([])
    expect(notesByRef('  ', files)).toEqual([])
  })
})

describe('PowerShell quoting', () => {
  it('single quotes, the quotes inside doubled', () => {
    expect(psQuote("C:\\My Files\\it's")).toBe("'C:\\My Files\\it''s'")
    expect(psQuote('a’b')).toBe("'a’’b'")
    expect(psQuote(undefined)).toBe("''")
  })
})

describe('note(…) in a preset', () => {
  const leaf = (path: string): VaultNode => ({ path, name: path, dir: false, mtime: 0, ctime: 0 })
  const tree: VaultNode[] = [
    leaf('Список.md'),
    { path: 'a', name: 'a', dir: true, mtime: 0, ctime: 0, children: [leaf('a/Двойник.md')] },
    { path: 'b', name: 'b', dir: true, mtime: 0, ctime: 0, children: [leaf('b/Двойник.md')] },
  ]
  const notes = new PresetNotes(() => ({ tree: () => tree, absPath: (rel) => `V:\\vault\\${rel.replace(/\//g, '\\')}` }))

  it('a note → its file; missing or ambiguous — a readable error', () => {
    expect(notes.note('Список')).toBe('V:\\vault\\Список.md')
    expect(notes.note('b/Двойник')).toBe('V:\\vault\\b\\Двойник.md')
    expect(() => notes.note('Нет')).toThrow(/заметки нет/)
    expect(() => notes.note('Двойник')).toThrow(/несколько.*a\/Двойник\.md/)
    expect(() => new PresetNotes(() => undefined).note('x')).toThrow(/не готов/)
  })
  it('renders into a command, quoted', () => {
    const { text } = renderPreset({ cwd: 'C:\\', vars: [], shell: 'powershell.exe', notes }, "lock.ps1 -ListFile {{ quote(note('Список')) }}", {})
    expect(text).toBe("lock.ps1 -ListFile 'V:\\vault\\Список.md'")
  })
  it('without the notebook a preset naming a note fails readably', () => {
    expect(() => renderPreset({ cwd: 'C:\\', vars: [], shell: 'powershell.exe' }, "{{ note('x') }}", {})).toThrow(/недоступна/)
  })
})
