import { describe, expect, it } from 'vitest'
import { periodLabel, periodRange, previousRange, rangeLabel, shiftedPeriod, type PeriodPick } from '../../src/shared/tracker/reportPeriod'

const pick = (p: Partial<PeriodPick>): PeriodPick => ({ period: 'week', anchor: '2026-10-14', from: '2026-10-01', to: '2026-10-07', ...p })

describe('report period', () => {
  it('ranges of each unit around the anchor', () => {
    expect(periodRange(pick({ period: 'day' }))).toEqual(['2026-10-14', '2026-10-14'])
    expect(periodRange(pick({ period: 'week' }))).toEqual(['2026-10-12', '2026-10-18'])
    expect(periodRange(pick({ period: 'month' }))).toEqual(['2026-10-01', '2026-10-31'])
    expect(periodRange(pick({ period: 'month', anchor: '2028-02-10' }))).toEqual(['2028-02-01', '2028-02-29'])
    expect(periodRange(pick({ period: 'year' }))).toEqual(['2026-01-01', '2026-12-31'])
  })
  it('a picked range comes back ordered', () => {
    expect(periodRange(pick({ period: 'custom', from: '2026-10-09', to: '2026-10-03' }))).toEqual(['2026-10-03', '2026-10-09'])
  })
  it('steps by the period length', () => {
    expect(shiftedPeriod(pick({ period: 'day' }), 1)).toEqual({ anchor: '2026-10-15' })
    expect(shiftedPeriod(pick({ period: 'week' }), -1)).toEqual({ anchor: '2026-10-07' })
    expect(shiftedPeriod(pick({ period: 'month', anchor: '2026-12-20' }), 1)).toEqual({ anchor: '2027-01-01' })
    expect(shiftedPeriod(pick({ period: 'year' }), -1)).toEqual({ anchor: '2025-10-01' })
    // a picked range moves by its own length (7 days here)
    expect(shiftedPeriod(pick({ period: 'custom' }), 1)).toEqual({ from: '2026-10-08', to: '2026-10-14' })
  })
  it('the previous range has the same length', () => {
    expect(previousRange(['2026-10-12', '2026-10-18'])).toEqual(['2026-10-05', '2026-10-11'])
  })
  it('labels', () => {
    expect(periodLabel('year', ['2026-01-01', '2026-12-31'])).toBe('2026')
    expect(periodLabel('month', ['2026-10-01', '2026-10-31'])).toMatch(/^Октябрь 2026$/)
    expect(periodLabel('custom', ['2026-10-01', '2026-10-31'])).toBe('')
    expect(rangeLabel(['2026-10-03', '2026-10-03'])).toContain('2026')
    expect(rangeLabel(['2026-10-03', '2026-10-09'])).toContain('–')
  })
})
