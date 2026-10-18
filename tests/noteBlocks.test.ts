import { describe, expect, it } from 'vitest'
import { boardMd, boardPathOf, parseWork, workMd, workRange, workReport, calloutMd, chartMd, findBlocks, newTable, parseCallout, parseChart, parseTable, parseToggle, tableMd, toggleMd } from '../src/shared/noteBlocks'

describe('note components', () => {
  it('finds them and leaves other code alone', () => {
    const text = ['# T', '| a | b |', '|---|:-:|', '| 1 | 2 |', '', '```chart', 'type: line', 'x | y', 'a | 1', '```', '```js', '| x | y |', '|---|---|', '```', '> [!warning] Осторожно', '> текст', '<details>', '<summary>Ещё</summary>', '', 'тело', '', '</details>', '```toc', '```'].join('\n')
    expect(findBlocks(text.split('\n')).map((b) => [b.kind, b.line0, b.line1])).toEqual([
      ['table', 2, 4],
      ['chart', 6, 10],
      ['callout', 15, 16],
      ['toggle', 17, 22],
      ['toc', 23, 24],
    ])
  })
  it('round-trips a table, pipes and line breaks included', () => {
    const t = { head: ['Имя', 'Код'], rows: [['a|b', 'x\ny']], align: [undefined, 'center' as const] }
    const md = tableMd(t)
    expect(md.split('\n')[1]).toMatch(/^\| -{3,} \| :-+: \|$/)
    expect(parseTable(md)).toEqual(t)
    expect(parseTable(tableMd(newTable(3, 2))).rows.length).toBe(1)
  })
  it('round-trips a chart, a callout and a fold', () => {
    const c = parseChart('```chart\ntype: pie\ntitle: Доли\nЧто, Сколько\nA, 1\nB, 2\n```')
    expect(c).toMatchObject({ type: 'pie', title: 'Доли', head: ['Что', 'Сколько'], rows: [['A', '1'], ['B', '2']] })
    expect(parseChart(chartMd(c))).toEqual(c)
    const co = { type: 'tip' as const, title: 'Совет', body: 'строка 1\n\nстрока 3' }
    expect(parseCallout(calloutMd(co))).toEqual(co)
    expect(parseCallout('> [!error] Упало').type).toBe('danger')
    const tg = { title: 'Подробнее', body: 'текст\n- пункт', open: true }
    expect(parseToggle(toggleMd(tg))).toEqual(tg)
  })
  it('keeps a table\'s column widths over it', () => {
    const t = { head: ['a', 'b'], rows: [['1', '2']], align: [undefined, undefined], widths: [120, 0] }
    const md = tableMd(t)
    expect(md.split('\n')[0]).toBe('<!-- qa:table widths=120,0 -->')
    expect(parseTable(md)).toEqual(t)
    expect(findBlocks(['x', ...md.split('\n'), 'y'])).toEqual([{ kind: 'table', line0: 2, line1: 5, src: md }])
  })
  it('a work report: periods, days, kinds, totals', () => {
    const w = { period: 'custom' as const, from: '2026-10-12', to: '2026-10-18', view: 'list' as const }
    expect(parseWork(workMd(w))).toEqual(w)
    expect(workRange({ period: 'this-week', view: 'table' }, new Date(2026, 9, 18))).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(workRange({ period: 'last-month', view: 'table' }, new Date(2026, 9, 18))).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    const H = 36e5
    const t0 = new Date(2026, 9, 15, 9).getTime()
    const r = workReport(
      [
        { day: '2026-10-15', entries: [{ id: 'a', kind: 'task', label: 'A', start: t0, end: t0 + 2 * H }, { id: 'b', kind: 'meeting', label: 'B', start: t0 + H, end: t0 + 3 * H }, { id: 'c', kind: 'lunch', label: 'L', start: t0 + 4 * H, end: t0 + 5 * H }] },
        { day: '2026-10-14', entries: [{ id: 'd', kind: 'task', label: 'D', start: t0 - 24 * H, end: t0 - 23 * H }] },
      ],
      (k) => k !== 'lunch',
      t0 + 30 * H,
    )
    expect(r.days.map((d) => [d.day, d.items.length, d.total / H])).toEqual([
      ['2026-10-14', 1, 1],
      ['2026-10-15', 2, 3],
    ])
    expect(r.byKind.map((k) => [k.kind, k.ms / H])).toEqual([
      ['task', 3],
      ['meeting', 2],
    ])
    expect(r.total / H).toBe(4)
  })
  it('audio, pictures and boards are components too', () => {
    const lines = ['a', '![[.audio/2026-10-18-ab12cd34.webm]]', '![[.images/x-1.png]]', '```board', 'path: Доски/План.qboard', '```']
    expect(findBlocks(lines).map((b) => [b.kind, b.line0, b.line1])).toEqual([
      ['audio', 2, 2],
      ['image', 3, 3],
      ['board', 4, 6],
    ])
    expect(boardPathOf(boardMd('Доски/План.qboard'))).toBe('Доски/План.qboard')
  })
})
