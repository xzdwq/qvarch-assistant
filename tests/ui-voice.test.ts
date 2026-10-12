import { describe, expect, it } from 'vitest'
import { DEFAULT_UI, mergeUi } from '../src/shared/ui'
import { titleFromTranscript } from '../src/shared/voice'

describe('titleFromTranscript', () => {
  it('takes the first sentence as the title and keeps the full text', () => {
    expect(titleFromTranscript(' Созвон с командой. Обсудили релиз и сроки. ')).toEqual({
      label: 'Созвон с командой.',
      description: 'Созвон с командой. Обсудили релиз и сроки.',
    })
  })
  it('a single short sentence needs no description', () => {
    expect(titleFromTranscript('Ревью кода')).toEqual({ label: 'Ревью кода', description: undefined })
  })
  it('cuts a long first sentence to 80 chars', () => {
    const r = titleFromTranscript('а'.repeat(120))
    expect(r.label.length).toBeLessThanOrEqual(80)
    expect(r.label.endsWith('…')).toBe(true)
    expect(r.description).toBe('а'.repeat(120))
  })
  it('an empty transcript gets a fallback title', () => {
    expect(titleFromTranscript('  ').label).toBe('Голосовое описание')
  })
})

describe('mergeUi', () => {
  it('fills missing groups and keys from the base', () => {
    const r = mergeUi(DEFAULT_UI, { pill: { wave: false } })
    expect(r.pill.wave).toBe(false)
    expect(r.pill.chips).toBe(true)
    expect(r.island).toEqual(DEFAULT_UI.island)
    expect(r.main).toEqual(DEFAULT_UI.main)
  })
  it('does not mutate the base', () => {
    mergeUi(DEFAULT_UI, { main: { ai: false } })
    expect(DEFAULT_UI.main.ai).toBe(true)
  })
})
