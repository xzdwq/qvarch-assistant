import { describe, expect, it } from 'vitest'
import { DRAFT_LIMITS, draftsFromDisk, draftsToKeep, type Draft } from '../../src/shared/drafts'

const now = Date.UTC(2026, 9, 31, 12)
const DAY = 86_400_000
const d = (v: string, ageDays = 0, keep = true): Draft => ({ v, at: now - ageDays * DAY, keep })

describe('drafts', () => {
  it('keeps on the disk only the kept, fresh, not too long ones', () => {
    const out = draftsToKeep({ chat: d('привет'), search: d('поиск', 0, false), old: d('давно', DRAFT_LIMITS.maxAgeDays + 1), long: d('x'.repeat(DRAFT_LIMITS.maxChars + 1)), empty: d('') }, now)
    expect(Object.keys(out)).toEqual(['chat'])
  })
  it('keeps the newest when there are too many', () => {
    const all = Object.fromEntries(Array.from({ length: DRAFT_LIMITS.maxKept + 5 }, (_, i) => [`k${i}`, { v: 't', at: now - i, keep: true }]))
    const out = draftsToKeep(all, now)
    expect(Object.keys(out)).toHaveLength(DRAFT_LIMITS.maxKept)
    expect(out.k0).toBeTruthy()
    expect(out[`k${DRAFT_LIMITS.maxKept + 4}`]).toBeUndefined()
  })
  it('reads back only well-formed, fresh drafts', () => {
    expect(draftsFromDisk(null, now)).toEqual({})
    expect(draftsFromDisk([1, 2], now)).toEqual({})
    const out = draftsFromDisk({ a: { v: 'текст', at: now - DAY }, b: { v: 1, at: now }, c: { v: 'x', at: now - 99 * DAY }, e: null, f: { v: '', at: now } }, now)
    expect(out).toEqual({ a: { v: 'текст', at: now - DAY, keep: true } })
  })
})
