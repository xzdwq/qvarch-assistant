import { describe, expect, it } from 'vitest'
import { chartMd, chartTypeOf, parseChart, seriesColor } from '../../src/notebook/blocks/chart/model'
import { calloutMd, parseCallout } from '../../src/notebook/blocks/callout/model'
import { parseTable, tableMd } from '../../src/notebook/blocks/table/model'
import { parseWork, workMd } from '../../src/notebook/blocks/work/model'
import { isCodeLang, parseInfo } from '../../src/notebook/domain/blockInfo'
import { LOOP_MAX, LOOP_PARALLEL_LIMIT, parseLoopInfo } from '../../src/notebook/domain/loop'
import { resolvePath } from '../../src/notebook/domain/values'

describe('info line settings', () => {
  it('each key checks its value; unknown keys and object-prototype names are ignored', () => {
    expect(parseInfo('json name=items ref=a.b db=main out=acc view=table timeout=99999 browser=chrome')).toMatchObject({
      lang: 'json',
      name: 'items',
      ref: 'a.b',
      db: 'main',
      out: 'acc',
      view: 'table',
      timeout: 3600,
      browser: 'chrome',
    })
    const bad = parseInfo('ts name=ctx out=all view=list timeout=-1 browser=opera constructor=x toString=1')
    expect(bad).toEqual({ lang: 'ts', run: false, lib: false })
    expect(isCodeLang('typescript') && isCodeLang('js') && !isCodeLang('python')).toBe(true)
  })
  it('a loop: capped counts, the defaults kept for bad ones', () => {
    expect(parseLoopInfo('name=rows parallel=99 max=0 timeout=abc soft')).toEqual({ name: 'rows', parallel: LOOP_PARALLEL_LIMIT, max: LOOP_MAX, timeout: 600, soft: true })
    expect(parseLoopInfo('parallel=2.7 constructor=1')).toMatchObject({ parallel: 2 })
  })
})

describe('paths into the values', () => {
  const ctx = { a: { list: [{ id: 7 }], 'x-y': 'z', s: 'abc' } }
  it('fields, indexes, quoted keys, lengths; a bad step — not found', () => {
    expect(resolvePath(ctx, 'a.list[0].id')).toEqual({ ok: true, value: 7 })
    expect(resolvePath(ctx, 'a["x-y"]')).toEqual({ ok: true, value: 'z' })
    expect(resolvePath(ctx, "a.s.length")).toEqual({ ok: true, value: 3 })
    expect(resolvePath(ctx, 'a.list.length')).toEqual({ ok: true, value: 1 })
    expect(resolvePath(ctx, 'a.none.deeper')).toEqual({ ok: true, value: undefined })
    expect(resolvePath(ctx, 'a..b')).toEqual({ ok: false })
    expect(resolvePath(ctx, 'b')).toEqual({ ok: false })
  })
})

describe('table alignment', () => {
  it('reads and writes every alignment; none — a plain rule', () => {
    const t = parseTable('| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |')
    expect(t.align).toEqual(['left', 'center', 'right', undefined])
    expect(tableMd(t)).toBe('| a   |  b  |   c | d   |\n| :-- | :-: | --: | --- |\n| 1   |  2  |   3 | 4   |')
  })
})

describe('work model', () => {
  it('settings checked by their key; from + to make a custom period', () => {
    expect(parseWork('```work\nperiod: last-week\nview: list\nhide: call, meet\nview: grid\n```')).toEqual({ period: 'last-week', view: 'list', hide: ['call', 'meet'] })
    const m = parseWork('```work\nperiod: today\nfrom: 2024-01-02\nto: 2024-01-05\nto: bad\n```')
    expect(m).toEqual({ period: 'custom', view: 'table', from: '2024-01-02', to: '2024-01-05' })
    expect(workMd(m)).toBe('```work\nperiod: custom\nfrom: 2024-01-02\nto: 2024-01-05\nview: table\n```')
  })
})

describe('chart model', () => {
  it('settings before the data; a setting after it is data; an unknown type is ignored', () => {
    const m = parseChart('```chart\nType: line\ntitle:  Продажи \nstacked: да\nМесяц | План\nЯнв | 1\ntitle: x | 2\n```')
    expect(m).toMatchObject({ type: 'line', title: 'Продажи', stacked: true, head: ['Месяц', 'План'] })
    expect(m.rows).toEqual([['Янв', '1'], ['title: x', '2']])
    expect(parseChart('```chart\ntype: radar\na,b\n```').type).toBe('bar')
  })
  it('the separator by preference: | then ; then tab then comma', () => {
    expect(parseChart('```chart\na;b|c\n```').head).toEqual(['a;b', 'c'])
    expect(parseChart('```chart\na\tb;c\n```').head).toEqual(['a\tb', 'c'])
    expect(parseChart('```chart\na\tb,c\n```').head).toEqual(['a', 'b,c'])
    expect(parseChart('```chart\na,b\n```').head).toEqual(['a', 'b'])
  })
  it('round trip, types and series colours', () => {
    const src = '```chart\ntype: area\ntitle: T\nstacked: true\nA | B\n1 | 2\n```'
    expect(chartMd(parseChart(src))).toBe(src)
    expect(chartTypeOf('area')).toMatchObject({ shape: 'lines', stackable: true })
    expect(chartTypeOf('pie').stackable).toBe(false)
    expect(seriesColor(0)).toBe('var(--chart-series-1)')
    expect(seriesColor(9)).toBe('var(--chart-series-2)')
  })
})

describe('callout model', () => {
  it('own types, aliases and the fallback', () => {
    expect(parseCallout('> [!WARNING]+ Осторожно\n> текст')).toEqual({ type: 'warning', title: 'Осторожно', body: 'текст' })
    expect(parseCallout('> [!bug]').type).toBe('danger')
    expect(parseCallout('> [!constructor]').type).toBe('note')
    expect(calloutMd({ type: 'tip', title: '', body: 'a\n\nb' })).toBe('> [!tip]\n> a\n>\n> b')
  })
})
