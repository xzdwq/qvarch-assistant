import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { EMOJI_IN, EMOJI_ONLY, isEmoji, mayHaveEmoji } from '../../src/shared/emoji'

/** Every emoji the picker offers (the same list: emojibase, its letters and skin-tone parts left out). */
const offered = (): string[] => {
  const file = createRequire(import.meta.url).resolve('emojibase-data/ru/compact.json')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Array<{ unicode: string; group?: number; skins?: Array<{ unicode: string }> }>
  return raw.filter((e) => e.group !== undefined && e.group !== 2).flatMap((e) => [e.unicode, ...(e.skins ?? []).map((s) => s.unicode)])
}

describe('emoji', () => {
  it('every emoji of the picker is one emoji — flags, keycaps, families, skin tones', () => {
    const all = offered()
    expect(all.length).toBeGreaterThan(1500)
    expect(all.filter((e) => !isEmoji(e))).toEqual([])
  })
  it('flags of every kind', () => {
    for (const e of ['🇶🇦', '🇷🇺', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏳️‍🌈', '🏴‍☠️']) expect(isEmoji(e)).toBe(true)
  })
  it('no text, no two emoji, no lone parts', () => {
    for (const x of ['', 'QA', '1', '#', 'a⭐', '⭐⭐', '🇶', '<b>⭐</b>', '‍', 42, undefined]) expect(isEmoji(x)).toBe(false)
  })
  it('found in a text whole: a flag is not two letters, a keycap not a digit', () => {
    const text = 'итог 🇶🇦 и 1️⃣, 👩‍💻 ok 12'
    expect(mayHaveEmoji(text)).toBe(true)
    expect(mayHaveEmoji('просто 12 текст')).toBe(false)
    EMOJI_IN.lastIndex = 0
    expect([...text.matchAll(EMOJI_IN)].map((m) => m[0])).toEqual(['🇶🇦', '1️⃣', '👩‍💻'])
  })
  it('up to three emoji alone on a line — big', () => {
    expect(EMOJI_ONLY.test(' 🇶🇦 🎉')).toBe(true)
    expect(EMOJI_ONLY.test('🎉🎉🎉🎉')).toBe(false)
    expect(EMOJI_ONLY.test('🎉 да')).toBe(false)
  })
})
