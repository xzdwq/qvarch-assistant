import { describe, expect, it } from 'vitest'
import { refRoot, saveMd, saveOf, withSave } from '../../src/notebook/blocks/save/model'
import { savesOf, withSaveBlock } from '../../src/notebook/blocks/save/modelNotes'

describe('«Сохранить в файл»: its settings', () => {
  it('read from its body; missing or wrong — defaults', () => {
    expect(saveOf('ref: rows')).toEqual({ ref: 'rows', format: 'auto', dir: '', partial: 'mark' })
    expect(saveOf('ref: {{ login.body }}\nformat: CSV\ndir: D:\\Мои выгрузки\\a b\nfiles: 30\npartial: skip')).toEqual({ ref: 'login.body', format: 'csv', dir: 'D:\\Мои выгрузки\\a b', files: 30, partial: 'skip' })
    expect(saveOf('format: doc\nfiles: 0\npartial: maybe')).toMatchObject({ format: 'auto', partial: 'mark' })
    expect(saveOf('files: 0').files).toBeUndefined()
  })
  it('a setting written; a default or an empty one — its line gone', () => {
    let b = withSave('ref: rows', 'format', 'xlsx')
    expect(b).toBe('ref: rows\nformat: xlsx')
    b = withSave(b, 'format', 'auto')
    expect(b).toBe('ref: rows')
    expect(withSave('ref: rows\nfiles: 5', 'files', '')).toBe('ref: rows')
    expect(withSave('ref: rows', 'dir', 'C:\\a b')).toBe('ref: rows\ndir: C:\\a b')
  })
  it('the «Значение» button: a block put at the note\'s end — once', () => {
    const note = '# Заметка\n\n```json ref=rows\n```\n'
    const once = withSaveBlock(note, 'rows')
    expect(once.endsWith(`${saveMd('rows')}\n`)).toBe(true)
    expect(savesOf(once, 'rows')).toBe(true)
    expect(savesOf(once, 'other')).toBe(false)
    expect(withSaveBlock(once, 'rows')).toBe(once)
    expect(refRoot('login.body.items')).toBe('login')
  })
})
