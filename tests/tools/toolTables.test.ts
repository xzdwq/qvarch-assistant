import { describe, expect, it } from 'vitest'
import { ARROW_SHIFTS, isArrowKey } from '../../src/shared/arrowKeys'
import { convertCron, CRON_DIALECTS, CRON_FORMATS, fitsFormat, fromCrontab, nextRuns } from '../../src/shared/cron'
import { jwtTimes, sniffEncoded, sniffMime, uuid, uuidInfo } from '../../src/shared/codec'
import { DEFAULT_INK, GRID_KINDS, isLineKind, parseBoard, SHAPES } from '../../src/shared/whiteboard'
import { snapStroke } from '../../src/shared/whiteboard/inkSnap'

describe('arrow keys', () => {
  it('knows the four arrows and their shifts', () => {
    expect(Object.keys(ARROW_SHIFTS)).toHaveLength(4)
    expect(isArrowKey('ArrowUp')).toBe(true)
    expect(ARROW_SHIFTS.ArrowUp).toEqual([0, -1])
    expect(isArrowKey('Enter')).toBe(false)
    expect(isArrowKey('toString')).toBe(false)
  })
})

describe('cron dialects', () => {
  it('lists every dialect in the switch, each with a legend for each of its places', () => {
    expect(CRON_FORMATS.map((f) => f.id)).toEqual(['crontab', 'spring', 'quartz'])
    for (const d of Object.values(CRON_DIALECTS)) expect(d.fields.length).toBe(Math.max(...d.fieldCounts))
  })
  it('tells whether a number of fields fits a dialect', () => {
    expect(fitsFormat(5, 'crontab')).toBe(true)
    expect(fitsFormat(6, 'crontab')).toBe(false)
    expect(fitsFormat(6, 'spring')).toBe(true)
    expect(fitsFormat(7, 'spring')).toBe(false)
    expect(fitsFormat(6, 'quartz')).toBe(true)
    expect(fitsFormat(7, 'quartz')).toBe(true)
  })
  it('moves between dialects: seconds kept between the ones that have them, lost going to Unix', () => {
    expect(convertCron('15 0 12 * * 1-6', 'spring', 'crontab')).toBe('0 12 * * 1-6')
    expect(convertCron('15 0 12 ? * 2-7', 'quartz', 'spring')).toBe('15 0 12 * * 1-6')
    expect(convertCron('0 12 * * 1-6', 'crontab', 'spring')).toBe('0 0 12 * * 1-6')
    expect(fromCrontab('0  12 * * *', 'crontab')).toBe('0  12 * * *')
    expect(fromCrontab('0 12 1 * *', 'quartz')).toBe('0 0 12 1 * ?')
  })
  it('limits Quartz runs by its year field', () => {
    const from = new Date(2026, 0, 1)
    expect(nextRuns('0 0 12 1 1 ? 2030', 'quartz', 3, from).map((d) => d.getFullYear())).toEqual([2030])
    expect(nextRuns('0 0 12 1 1 ? *', 'quartz', 2, from).map((d) => d.getFullYear())).toEqual([2026, 2027])
  })
})

describe('codec tables', () => {
  it('knows files by their first bytes, in order', () => {
    const bytes = (s: string) => new TextEncoder().encode(s)
    expect(sniffMime(bytes('%PDF-1.7'))).toEqual({ mime: 'application/pdf', ext: 'pdf', image: false })
    expect(sniffMime(bytes('<?xml version="1.0"?><svg xmlns="x">'))?.ext).toBe('svg')
    expect(sniffMime(new Uint8Array([0x1f, 0x8b, 8]))?.mime).toBe('application/gzip')
    expect(sniffMime(bytes('plain text'))).toBeUndefined()
  })
  it('names password hashes by their scheme', () => {
    const title = (s: string) => sniffEncoded(s)[0].title
    expect(title('$2y$10$abcdefghijklmnopqrstuv')).toMatch(/bcrypt$/)
    expect(title('$6$salt$hash')).toMatch(/SHA-512-crypt$/)
    expect(title('$y$j9T$salt$hash')).toMatch(/yescrypt$/)
    expect(title('$argon2id$v=19$m=65536$x')).toMatch(/argon2id$/)
  })
  it('notes the time claims of a token', () => {
    const now = 1_000_000_000_000
    const t = jwtTimes({ exp: now / 1000 - 1, nbf: now / 1000 + 1, iat: now / 1000, sub: 'x' }, now)
    expect(t.map((x) => [x.key, x.note])).toEqual([
      ['iat', ''],
      ['nbf', 'ещё не действует'],
      ['exp', 'истёк'],
    ])
  })
  it('makes UUIDs of each version and reads back the time of the time-based ones', () => {
    const now = Date.UTC(2026, 4, 1, 10, 0, 0)
    for (const v of [1, 4, 7] as const) expect(uuidInfo(uuid(v, now))).toMatchObject({ valid: true, version: v })
    expect(uuidInfo(uuid(7, now)).time).toBe(now)
    expect(uuidInfo(uuid(1, now)).time).toBe(now)
    expect(uuidInfo(uuid(4, now)).time).toBeUndefined()
  })
})

describe('board tables', () => {
  it('tells lines from boxes and keeps the file defaults', () => {
    expect(SHAPES.filter((s) => isLineKind(s.kind)).map((s) => s.kind)).toEqual(['line', 'arrow', 'arrow2'])
    expect(GRID_KINDS).toContain('iso')
    const b = parseBoard(JSON.stringify({ bg: { grid: 'nope' }, items: [{ type: 'text', text: 'a', x: 0, y: 0 }] }))
    expect(b.bg.grid).toBe('dots')
    expect(b.items[0]).toMatchObject({ color: DEFAULT_INK })
  })
  it('names a snapped shape, by its equal sides when it has a name for them', () => {
    const st = { color: '#000000', opacity: 1, size: 3 }
    const shape = (kind: 'ellipse' | 'rect' | 'diamond', w: number, h: number) => snapStroke({ type: 'shape', kind, cx: 0, cy: 0, w, h, rot: 0 }, [[0, 0, 0.5]], st, 4).hint
    expect(shape('rect', 10, 10)).toBe('Квадрат')
    expect(shape('rect', 10, 20)).toBe('Прямоугольник')
    expect(shape('ellipse', 10, 10)).toBe('Круг')
    expect(shape('diamond', 10, 10)).toBe('Ромб')
  })
})
