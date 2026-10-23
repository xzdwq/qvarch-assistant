import { describe, expect, it } from 'vitest'
import { emptySpec, guessColumn, makeFiles, typeOf, type XSpec } from '../src/shared/excelGen'
import { gen } from '../src/shared/gen'

// the values made by a little evaluator for the tests (the main process runs gen.… the same way)
const make = (expr: string) => String(new Function('gen', `return (${expr})`)(gen))

describe('Excel: the files of a spec', () => {
  const spec: XSpec = { ...emptySpec(), rows: 5, columns: [...emptySpec().columns.slice(0, 2), { title: 'Код', expr: "gen.pattern('AA-###')", type: 'auto', required: false, unique: true, maxLen: 6 }] }
  it('the right file: N rows, cells by their types, unique values', () => {
    const [ok] = makeFiles(spec, [], make)
    expect(ok).toMatchObject({ name: 'данные', expect: 'ok' })
    expect(ok.sheets[0].header).toEqual(['Наименование', 'Количество', 'Код'])
    expect(ok.sheets[0].rows).toHaveLength(5)
    expect(ok.sheets[0].rows[0][1].t).toBe('number')
    expect(new Set(ok.sheets[0].rows.map((r) => r[0].v)).size).toBe(5)
    expect(typeOf(emptySpec().columns[3])).toBe('date')
  })
  it('one file per fault (and per column where it is a column\'s), with what it should lead to', () => {
    const files = makeFiles(spec, ['empty', 'type', 'long', 'dup', 'nocol', 'header', 'extra', 'sheet2'], make)
    const names = files.map((f) => f.name)
    expect(names).toEqual([
      'данные',
      'данные — пусто «Наименование»',
      'данные — пусто «Количество»',
      'данные — текст в «Количество»',
      'данные — длинное «Код»',
      'данные — повтор «Наименование»',
      'данные — повтор «Код»',
      'данные — нет «Наименование»',
      'данные — только заголовок',
      'данные — лишняя колонка',
      'данные — второй лист',
    ])
    const empty = files[1]
    expect(empty).toMatchObject({ expect: 'bad', note: 'пустая «Наименование» в строке 3' })
    expect(empty.sheets[0].rows[1][0].v).toBeNull()
    expect(files[3].sheets[0].rows[1][1]).toEqual({ v: 'abc', t: 'text' })
    expect(String(files[4].sheets[0].rows[1][2].v)).toHaveLength(7)
    expect(files[7].sheets[0].header).toEqual(['Количество', 'Код'])
    expect(files[9].expect).toBeUndefined()
    expect(files[10].sheets.map((s) => s.name)).toEqual(['Пустой', 'Лист1'])
    // the rest of the faults, in the list's order whatever order they are asked in
    const more = makeFiles(spec, ['big', 'textnum', 'spaces', 'blank', 'title', 'order'], make).slice(1)
    expect(more.map((f) => f.name.split(' — ')[1])).toEqual(['другой порядок', 'заголовки иначе', 'пустые строки', 'пробелы по краям', 'числа текстом', '10000 строк'])
    expect(more[0].sheets[0].header).toEqual(['Код', 'Количество', 'Наименование'])
    expect(more[1].sheets[0].header[0]).toBe(' НАИМЕНОВАНИЕ ')
    // 5 rows: an empty one after rows 1 and 4 (never after the last)
    expect(more[2].sheets[0].rows.map((r) => r[0].v === null)).toEqual([false, true, false, false, false, true, false])
    expect(String(more[3].sheets[0].rows[0][0].v)).toMatch(/^ {2}.+ {2}$/)
    expect(more[4].sheets[0].asText).toBe(true)
    expect(more[5]).toMatchObject({ expect: 'ok' })
    expect(more[5].sheets[0].rows).toHaveLength(10_000)
    // csv has no sheets: the xlsx-only faults are left out
    expect(makeFiles({ ...spec, format: 'csv' }, ['sheet2', 'textnum'], make)).toHaveLength(1)
  })
})

describe('Excel: the columns from a template', () => {
  it('by the values under the titles', () => {
    expect(guessColumn('Количество', ['5', '10', '3'])).toMatchObject({ expr: 'gen.int(1, 20)', required: true })
    expect(guessColumn('Цена', ['12,50', '7,1'])).toMatchObject({ expr: 'gen.number(0, 25, 2, true)' })
    expect(guessColumn('Дата', ['01.02.2024', '15.03.2024']).expr).toBe('gen.date(0)')
    expect(guessColumn('Ед.', ['шт', 'кг', 'шт', 'шт']).expr).toBe("gen.oneOf('шт', 'кг')")
    expect(guessColumn('Артикул', ['AB-1234', 'CD-5678'])).toMatchObject({ expr: "gen.pattern('AA-####')", unique: true })
    expect(guessColumn('Наименование', ['Болт М8', 'Гайка'])).toMatchObject({ expr: 'gen.words(2)', unique: true })
    expect(guessColumn('Комментарий', ['', 'да'])).toMatchObject({ required: false })
  })
})
