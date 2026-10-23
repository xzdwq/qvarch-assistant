import { describe, expect, it } from 'vitest'
import { dayStart, HOUR } from '../../src/shared/timeline'
import type { ReportItem } from '../../src/shared/report'
import type { Entry } from '../../src/shared/types'
import { changePct, groupHead, kpiCards, reportCsv, reportInsights } from '../../src/shared/tracker/reportStats'
import { barCaption, barSegments, chartUnit, seriesOrder, seriesScheme, yScale, yTicks } from '../../src/shared/tracker/reportChart'

const look = { label: (k: string) => `L:${k}`, color: (k: string) => `C:${k}` }
let n = 0
function item(day: string, fromH: number, toH: number, extra: Partial<Entry> = {}): ReportItem {
  const d0 = dayStart(day)
  return { day, e: { id: `e${n++}`, start: d0 + fromH * HOUR, end: d0 + toH * HOUR, kind: 'task', label: 'work', source: 'manual', ...extra } }
}

describe('report totals', () => {
  const days = ['2026-10-12', '2026-10-13']
  const items = [item(days[0], 9, 11), item(days[0], 10, 12, { kind: 'call' }), item(days[1], 9, 10, { task: { key: 'ABC-1', summary: 's' } })]
  const prev = [item('2026-10-05', 9, 10)]
  it('cards: union totals, daily average, per-day curve', () => {
    const k = kpiCards(items, prev, days, look)
    expect(k.map((x) => x.label)).toEqual(['Всего', 'В среднем за день', 'Jira', 'Созвоны', 'Встречи'])
    expect(k[0].ms).toBe(4 * HOUR) // 9–12 and 9–10, parallel time counted once
    expect(k[0].spark).toEqual([3 * HOUR, HOUR])
    expect(k[1].ms).toBe(2 * HOUR)
    expect(k[2].ms).toBe(HOUR)
    expect(k[3].color).toBe('C:call')
    expect(changePct(k[0])).toBe(300)
    expect(changePct({ ms: 5, prev: 0 })).toBeUndefined()
  })
  it('insights start with the biggest event and compare with the past', () => {
    const k = kpiCards(items, prev, days, look)
    const events = [{ key: 'x', label: 'work', kind: 'task', count: 2, ms: 3 * HOUR, avg: 1.5 * HOUR, days: 2, perDay: [] }]
    const ins = reportInsights({ items, total: 4 * HOUR, events, kpi: k, days, heat: [[0, 2, 1]], kindLabel: look.label })
    expect(ins[0]).toMatchObject({ k: 'Больше всего' })
    expect(ins.find((x) => x.k === 'Пик по часам')?.v).toBe('1:00–2:00')
    expect(ins.at(-1)).toEqual({ k: 'К прошлому периоду', v: '+300%', tone: 'up' })
    expect(reportInsights({ items: [], total: 0, events: [], kpi: k, days, heat: [], kindLabel: look.label })).toEqual([])
  })
  it('group heads per grouping', () => {
    expect(groupHead('call', 'kind', look, () => '')).toEqual({ name: 'L:call', color: 'C:call' })
    expect(groupHead('', 'task', look, () => '')).toEqual({ name: 'Без задачи', color: 'var(--report-task-none)' })
    expect(groupHead('Q-3', 'task', look, () => 'own')).toEqual({ name: 'Q-3', sub: 'own', color: 'var(--report-task-own)' })
    expect(groupHead('ABC-1', 'task', look, () => 's').color).toBe('var(--report-task-jira)')
    expect(groupHead('2026-10-12', 'day', look, () => '').color).toBe('var(--accent)')
  })
  it('csv: header, BOM, decimal comma, quoted text', () => {
    const csv = reportCsv([item(days[0], 9, 10.5, { label: 'say "hi"' })], look.label)
    const lines = csv.split('\r\n')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(lines[1]).toContain(';1,50;')
    expect(lines[1]).toContain('"say ""hi"""')
  })
})

describe('report chart', () => {
  it('unit by period length', () => {
    expect([chartUnit(31), chartUnit(90), chartUnit(365)]).toEqual(['day', 'week', 'month'])
  })
  it('axis: round top, at most ~4 steps', () => {
    const s = yScale([{ key: 'a', parts: new Map(), total: 7 * HOUR }])
    expect(s).toEqual({ top: 8 * HOUR, step: 2 * HOUR })
    expect(yTicks(s)).toHaveLength(5)
  })
  it('series: biggest first; segments scaled to the bar total', () => {
    const bars = [{ key: 'a', parts: new Map([['x', HOUR], ['y', 3 * HOUR]]), total: 2 * HOUR }]
    const order = seriesOrder(bars)
    expect(order).toEqual(['y', 'x'])
    expect(barSegments(bars[0], order, 4 * HOUR)).toEqual([{ s: 'y', h: 37.5 }, { s: 'x', h: 12.5 }])
  })
  it('task scheme: top tasks, the rest, none', () => {
    const sc = seriesScheme('task', ['A-1'], look)
    expect(sc.of(item('2026-10-12', 1, 2, { task: { key: 'A-1', summary: '' } }))).toBe('A-1')
    expect(sc.of(item('2026-10-12', 1, 2, { task: { key: 'B-2', summary: '' } }))).toBe('*')
    expect(sc.of(item('2026-10-12', 1, 2))).toBe('')
    expect([sc.label(''), sc.label('*'), sc.label('A-1')]).toEqual(['Без задачи', 'Другие задачи', 'A-1'])
  })
  it('captions show weekdays only while days are few', () => {
    expect(barCaption('2026-10-12', 'day', 7).sub).toBeTruthy()
    expect(barCaption('2026-10-12', 'day', 30).sub).toBeUndefined()
  })
})
