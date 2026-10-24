import { describe, expect, it } from 'vitest'
import { gridFromClipboard, gridFromRanges, guessHeadRow, htmlTableCells, isTableClipboard, layoutSpans, parseDelimited, detectSeparator, rowsCsv, trimGrid } from '../../src/shared/tableData'

/** What Excel puts on the clipboard for A1:C3 with A1:B1 merged and C1:C2 merged (trimmed to its shape). */
const EXCEL_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!--td {mso-number-format:General;}--></style></head>
<body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=192>
 <!--[if gte mso 9]><xml>junk</xml><![endif]-->
 <tr height=20 style='height:15.0pt'>
  <td colspan=2 height=20 class=xl65 width=128 style='height:15.0pt;width:96pt'>Заказ&nbsp;№</td>
  <td rowspan=2 class=xl66 width=64>Сумма,<br style='mso-data-placement:same-cell' />руб.</td>
 </tr>
 <tr height=20>
  <td height=20 align=right>1</td>
  <td>Альфа &amp; Ко</td>
 </tr>
 <tr height=20>
  <td align=right x:num>2</td>
  <td>Бета</td>
  <td align=right x:num="1500">1 500</td>
 </tr>
<!--EndFragment--></table></body></html>`

describe('a table from a spreadsheet\'s HTML', () => {
  it('reads cells with their spans, text as shown (entities, <br>, white space)', () => {
    const rows = htmlTableCells(EXCEL_HTML)!
    expect(rows.map((r) => r.map((c) => c.text))).toEqual([['Заказ №', 'Сумма,\nруб.'], ['1', 'Альфа & Ко'], ['2', 'Бета', '1 500']])
    expect(rows[0][0].colSpan).toBe(2)
    expect(rows[0][1].rowSpan).toBe(2)
  })
  it('lays the spans out as a table does: a cell skips the columns held from above', () => {
    const g = layoutSpans(htmlTableCells(EXCEL_HTML)!)
    expect(g.rows).toEqual([
      ['Заказ №', '', 'Сумма,\nруб.'],
      ['1', 'Альфа & Ко', ''],
      ['2', 'Бета', '1 500'],
    ])
    expect(g.merges).toEqual([
      { r: 0, c: 0, rs: 1, cs: 2 },
      { r: 0, c: 2, rs: 2, cs: 1 },
    ])
  })
  it('no table in the HTML — none', () => {
    expect(htmlTableCells('<p>просто текст</p>')).toBeUndefined()
  })
  it('a span past the last row ends at it', () => {
    expect(layoutSpans([[{ text: 'a', rowSpan: 5 }], [{ text: 'b' }]]).merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 1 }])
  })
})

describe('delimited text', () => {
  it('finds the separator by the lines (a tab wins a tie)', () => {
    expect(detectSeparator('a;b;c\n1;2;3')).toBe(';')
    expect(detectSeparator('a,b\n1,2')).toBe(',')
    expect(detectSeparator('a\tb\n1\t2')).toBe('\t')
    expect(detectSeparator('одна строка без разделителей')).toBe('\t')
  })
  it('reads quotes: a separator, a line break and "" inside a cell; CRLF; a BOM; no empty last row', () => {
    const g = parseDelimited('﻿имя;заметка\r\n"Болт; M6";"две\r\nстроки ""в кавычках"""\r\n', ';')
    expect(g.rows).toEqual([
      ['имя', 'заметка'],
      ['Болт; M6', 'две\nстроки "в кавычках"'],
    ])
  })
  it('rows of different lengths made even', () => {
    expect(parseDelimited('a\tb\tc\n1', '\t').rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ])
  })
  it('writes CSV back (quoted when needed, a BOM for Excel)', () => {
    expect(rowsCsv([{ name: 'a' }, { name: 'b' }], [['1, 2', 'x"y']])).toBe('﻿a,b\r\n"1, 2","x""y"\r\n')
  })
})

describe('the clipboard', () => {
  it('prefers the HTML (it knows merged cells) to the plain text', () => {
    const g = gridFromClipboard({ html: EXCEL_HTML, text: 'Заказ №\t\tСумма' })!
    expect(g.merges).toHaveLength(2)
  })
  it('reads plain text by tabs only: a comma in copied text is text', () => {
    expect(gridFromClipboard({ text: 'Альфа, Бета' })!.rows).toEqual([['Альфа, Бета']])
    expect(gridFromClipboard({ text: 'a\tb\n1\t2\n' })!.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('is a table only when cells were copied (a table in the HTML or tabs), more than one', () => {
    expect(isTableClipboard({ html: EXCEL_HTML })).toBe(true)
    expect(isTableClipboard({ text: 'a\tb' })).toBe(true)
    expect(isTableClipboard({ text: 'строка\nвторая строка' })).toBe(false)
    expect(isTableClipboard({ text: 'Альфа, Бета' })).toBe(false)
    expect(isTableClipboard({ text: 'одно' })).toBe(false)
  })
})

describe('grids', () => {
  it('a sheet\'s merged ranges: the region\'s other cells empty', () => {
    const g = gridFromRanges(
      [
        ['A', 'A', 'B'],
        ['1', '2', '3'],
      ],
      [{ top: 0, left: 0, bottom: 0, right: 1 }],
    )
    expect(g.rows[0]).toEqual(['A', '', 'B'])
    expect(g.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }])
  })
  it('trailing empty rows and columns cut off — not through a merge', () => {
    const g = trimGrid({
      rows: [
        ['a', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
      ],
      merges: [{ r: 0, c: 0, rs: 2, cs: 2 }],
    })
    expect(g.rows).toEqual([
      ['a', ''],
      ['', ''],
    ])
  })
  it('guesses the head: a written row of words over data', () => {
    expect(guessHeadRow(parseDelimited('Имя\tСумма\nБолт\t12'))).toBe(true)
    expect(guessHeadRow(parseDelimited('Болт\t12\nГайка\t3'))).toBe(false)
    expect(guessHeadRow(parseDelimited('Имя\t\nБолт\t12'))).toBe(false)
    expect(guessHeadRow(parseDelimited('Только строка'))).toBe(false)
    // a merged head cell counts by its first cell
    expect(guessHeadRow(layoutSpans(htmlTableCells(EXCEL_HTML)!))).toBe(true)
  })
})
