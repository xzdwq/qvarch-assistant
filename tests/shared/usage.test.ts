import { describe, expect, it } from 'vitest'
import { claudeCodeUsage, tokensText, turnUsageOf, usageText, usageTotal } from '../../src/shared/agent/usage'
import { docAiOf, docTurnOf } from '../../src/shared/agent/docAi'

describe('what a turn cost', () => {
  it('read from the result of claude -p --output-format json', () => {
    const r = { result: 'ок', num_turns: 3, total_cost_usd: 0.07, usage: { input_tokens: 5, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1000, output_tokens: 40 } }
    expect(claudeCodeUsage(r)).toEqual({ input: 5, cacheRead: 8000, cacheWrite: 1000, output: 40, steps: 3, usd: 0.07 })
    expect(usageTotal(claudeCodeUsage(r)!)).toBe(9045)
  })
  it('an older result without the cache parts — counted as none; without usage — none at all', () => {
    expect(claudeCodeUsage({ usage: { input_tokens: 10, output_tokens: 2 } })).toEqual({ input: 10, cacheRead: 0, cacheWrite: 0, output: 2 })
    expect(claudeCodeUsage({ result: 'x' })).toBeUndefined()
    expect(claudeCodeUsage(null)).toBeUndefined()
  })
  it('a malformed one (another app, an older one) — not kept', () => {
    expect(turnUsageOf({ input: -1, cacheRead: 0, cacheWrite: 0, output: 0 })).toBeUndefined()
    expect(turnUsageOf({ input: '1', cacheRead: 0, cacheWrite: 0, output: 0 })).toBeUndefined()
    expect(turnUsageOf({ input: 1.4, cacheRead: 0, cacheWrite: 0, output: 0, usd: 'x' })).toEqual({ input: 1, cacheRead: 0, cacheWrite: 0, output: 0 })
  })
  it('kept in the journal with the turn; a broken one left out on reading', () => {
    const usage = { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 }
    const t = docTurnOf({ id: 't', at: 1, ms: 1, agent: 'A', owner: 'O', asker: 'B', question: 'q', trace: [], wrote: 0, usage })
    expect(t.usage).toEqual(usage)
    expect(docAiOf({ turns: [t] }).turns[0].usage).toEqual(usage)
    expect(docAiOf({ turns: [{ ...t, usage: { input: 'x' } }] }).turns[0].usage).toBeUndefined()
    expect(docTurnOf({ id: 't', at: 1, ms: 1, agent: 'A', owner: 'O', asker: 'B', question: 'q', trace: [], wrote: 0 }).usage).toBeUndefined()
  })
  it('said in short and in full', () => {
    expect(tokensText(950)).toBe('950')
    expect(tokensText(12_345)).toBe('12 тыс.')
    expect(tokensText(1_250_000)).toBe('1,25 млн')
    expect(usageText({ input: 0, cacheRead: 1000, cacheWrite: 0, output: 10, steps: 2, usd: 0.012 })).toContain('шагов модели: 2')
  })
})
