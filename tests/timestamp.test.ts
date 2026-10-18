import { describe, expect, it } from 'vitest'
import { fromExcel, isoIn, isoWeek, offsetIn, parseMoment, toExcel, unitOf } from '../src/shared/timestamp'

const T = Date.UTC(2026, 9, 18, 12, 30, 0, 250) // 2026-10-18T12:30:00.250Z

describe('timestamps', () => {
  it('reads numbers by their size', () => {
    expect(unitOf('1792326600')).toBe('s')
    expect(parseMoment('1792326600')).toBe(Date.UTC(2026, 9, 18, 12, 30))
    expect(parseMoment(String(T))).toBe(T)
    expect(parseMoment(String(T * 1000))).toBe(T)
    expect(parseMoment(`${T}000000`)).toBe(T)
    expect(parseMoment('1792326600.25')).toBe(T)
  })
  it('reads ISO, RFC 2822, SQL and Russian dates', () => {
    expect(parseMoment('2026-10-18T12:30:00.250Z')).toBe(T)
    expect(parseMoment('2026-10-18T15:30:00.250+03:00')).toBe(T)
    expect(parseMoment('Sun, 18 Oct 2026 12:30:00 GMT')).toBe(Date.UTC(2026, 9, 18, 12, 30))
    expect(parseMoment('2026-10-18 15:30:00')).toBe(new Date(2026, 9, 18, 15, 30).getTime())
    expect(parseMoment('18.10.2026 15:30')).toBe(new Date(2026, 9, 18, 15, 30).getTime())
    expect(parseMoment('31.02.2026')).toBeUndefined()
    expect(parseMoment('вчера в обед')).toBeUndefined()
  })
  it('writes a moment in a zone', () => {
    expect(isoIn(T, 'UTC')).toBe('2026-10-18T12:30:00.250+00:00')
    expect(isoIn(T, 'Europe/Moscow')).toBe('2026-10-18T15:30:00.250+03:00')
    expect(offsetIn(T, 'Asia/Kolkata')).toBe(330)
    expect(isoWeek(Date.UTC(2026, 0, 1, 12)).week).toBe(1)
    expect(fromExcel(toExcel(T))).toBeCloseTo(T, -2)
  })
})
