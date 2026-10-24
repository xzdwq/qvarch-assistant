import { describe, expect, it, vi } from 'vitest'
import { parseTable, tableMd, tableValue } from '../../src/notebook/blocks/table/model'
import { noteVarNames, tableVars } from '../../src/notebook/domain/tableVars'
import { noteRun, syncNoteData } from '../../src/notebook/engine'
import { setRunApi } from '../../src/notebook/engine/runApi'

setRunApi({ runLoad: vi.fn(async () => undefined), runSave: vi.fn(async () => undefined) } as unknown as Parameters<typeof setRunApi>[0])

const table = (meta: string, ...rows: string[]) => [...(meta ? [`<!-- qa:table ${meta} -->`] : []), '| Имя | Сумма |', '| --- | --- |', ...rows].join('\n')
const note = (...parts: string[]) => parts.join('\n\n')

describe('a table\'s value', () => {
  it('rows as objects; a merged head names each column it spans, a key met twice numbered', () => {
    const t = parseTable(['<!-- qa:table merge=-1.0.1.2 -->', '| Заказ |  | Заказ |', '| --- | --- | --- |', '| 1 | Альфа | x |'].join('\n'))
    expect(tableValue(t)).toEqual([{ Заказ: '1', 'Заказ 2': 'Альфа', 'Заказ 3': 'x' }])
  })
  it('a merged body cell: every row it covers has its text (each row whole)', () => {
    const t = parseTable(table('merge=0.1.2.1', '| Болт | 10 |', '| Гайка |  |'))
    expect(tableValue(t).map((r) => r['Сумма'])).toEqual(['10', '10'])
  })
})

describe('tables as variables of the note', () => {
  it('a name is kept in the file', () => {
    const t = parseTable(table('name=orders', '| a | 1 |'))
    expect(t.name).toBe('orders')
    expect(tableMd(t)).toMatch(/^<!-- qa:table name=orders -->/)
    // not a variable's name — not read
    expect(parseTable(table('name=1x')).name).toBeUndefined()
    expect(parseTable(table('name=page')).name).toBeUndefined()
  })
  it('a table not named is given one past the names taken (named ones first, the order kept)', () => {
    const text = note('```js run name=table\nreturn 1\n```', table(''), table('name=table2'), table(''))
    expect(tableVars(text).map((v) => [v.name, v.given])).toEqual([
      ['table3', true],
      ['table2', false],
      ['table4', true],
    ])
  })
  it('a name another block holds, or a table above: a clash (not published)', () => {
    const text = note('```js run name=rows\nreturn 1\n```', table('name=rows'), table('name=x'), table('name=x'))
    expect(tableVars(text).map((v) => v.clash)).toEqual(['block', undefined, 'table'])
    expect([...noteVarNames(text)].sort()).toEqual(['rows', 'x'])
  })
  it('published without a run; renamed — the old one taken away, a block\'s value never touched', () => {
    const path = 't/tables.md'
    syncNoteData(path, note(table('name=orders', '| Болт | 10 |'), table('name=x', '| a | 1 |')))
    const ctx = noteRun(path).ctx
    expect(ctx.orders).toMatchObject({ value: [{ Имя: 'Болт', Сумма: '10' }], from: 'table' })
    ctx.result = { value: 42, at: 1, from: 'code', block: 'result' }
    syncNoteData(path, note(table('name=goods', '| Болт | 10 |')))
    expect(Object.keys(ctx).sort()).toEqual(['goods', 'result'])
  })
})
