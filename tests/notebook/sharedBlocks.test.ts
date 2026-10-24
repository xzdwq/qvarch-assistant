import { describe, expect, it } from 'vitest'
import { boardBlocksOf, boardDocOf, boardMd } from '../../src/notebook/blocks/board/model'
import { parseWork, workMd } from '../../src/notebook/blocks/work/model'
import { isSpaceFile } from '../../src/shared/transport/space'

const DOC = '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b'

describe('a board block of a shared note', () => {
  it('carries its board\'s document; the note\'s board blocks found with it', () => {
    const md = boardMd('Проект/Доска.qboard', 'edit', DOC)
    expect(boardDocOf(md)).toBe(DOC)
    expect(boardDocOf(boardMd('x.qboard'))).toBe('')
    const text = `# Заметка\n\n${boardMd('a.qboard')}\n\nтекст\n\n${md}\n`
    expect(boardBlocksOf(text).map((b) => [b.path, b.mode, b.doc])).toEqual([
      ['a.qboard', 'view', ''],
      ['Проект/Доска.qboard', 'edit', DOC],
    ])
  })
})

describe('«Работа» of a shared note', () => {
  it('its owner and the owner\'s name kept through a write', () => {
    const m = parseWork(workMd({ period: 'this-week', view: 'list', owner: 'a'.repeat(32), by: 'Альфа' }))
    expect(m).toMatchObject({ owner: 'a'.repeat(32), by: 'Альфа' })
    expect(parseWork('```work\nowner: не-устройство\n```').owner).toBeUndefined()
    expect(workMd({ period: 'today', view: 'table' })).not.toMatch(/owner/)
  })
})

describe('a space\'s files', () => {
  it('pictures, recordings, test files of a set; nothing outside, nothing hidden', () => {
    expect(isSpaceFile('.images/2026-10-24-ab12cd34.png')).toBe(true)
    expect(isSpaceFile('.files/Импорт: ошибки/Пустой файл.xlsx')).toBe(true)
    expect(isSpaceFile('.files/../секрет.txt')).toBe(false)
    expect(isSpaceFile('.files/набор/..')).toBe(false)
    expect(isSpaceFile('.files/набор/.meta.json')).toBe(false)
    expect(isSpaceFile('.files/набор/вложенная/файл.txt')).toBe(false)
    expect(isSpaceFile('заметка.md')).toBe(false)
  })
})
