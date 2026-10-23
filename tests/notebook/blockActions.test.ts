import { describe, expect, it } from 'vitest'
import { blockActionsFor, blockCaps, blocksWord } from '../../src/notebook/commands/blockActions'

const ids = (kinds: Parameters<typeof blockCaps>[0]) => blockActionsFor(blockCaps(kinds), 'Таблица').map((a) => a.id)

describe('a block handle\'s menu: by what the blocks can do, not by their kind', () => {
  it('one block: run only when it runs, «as Markdown» only when it is kept as text', () => {
    expect(ids(['http'])).toEqual(['run', 'copy', 'dup', 'raw', 'del'])
    expect(ids(['image'])).not.toContain('run')
  })
  it('several: their count in the lines, run — the ones that run; never «as Markdown»', () => {
    const acts = blockActionsFor(blockCaps(['http', 'table', 'sql']), 'HTTP-запрос')
    expect(acts.map((a) => a.id)).toEqual(['run', 'copy', 'dup', 'del'])
    expect(acts.find((a) => a.id === 'run')?.label).toBe('Выполнить по порядку: 2 блока')
    expect(acts.find((a) => a.id === 'del')).toMatchObject({ label: 'Удалить 3 блока', danger: true })
  })
  it('counts in words', () => {
    expect([1, 2, 5, 11, 21, 22].map(blocksWord)).toEqual(['1 блок', '2 блока', '5 блоков', '11 блоков', '21 блок', '22 блока'])
  })
})
