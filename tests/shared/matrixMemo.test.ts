import { describe, expect, it } from 'vitest'
import { asked, fingerprint, matrixScenarioSig, valueKey } from '../../src/shared/qaMatrixQuery'

const scenario = (values: string, step = "await page.fill('#q', v.q)") =>
  ["await page.goto('/search')", 'await qa.fieldMatrix({', `  q: { values: [${values}] },`, '}, async (v) => {', `  ${step}`, '})'].join('\n')

describe('matrix memo', () => {
  it('a fingerprint tells texts apart and is stable', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'))
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'))
    expect(fingerprint('')).toMatch(/^[0-9a-f]{8}$/)
  })
  it('the scenario signature ignores the list of values, not the steps', () => {
    expect(matrixScenarioSig(scenario("'a'"))).toBe(matrixScenarioSig(scenario("'a', 'b'")))
    expect(matrixScenarioSig(scenario("'a'"))).not.toBe(matrixScenarioSig(scenario("'a'", "await page.fill('#q2', v.q)")))
  })
  it('a value key is its field and the value whole', () => {
    expect(valueKey('q', 'x')).toBe(valueKey('q', 'x'))
    expect(valueKey('q', 'x')).not.toBe(valueKey('p', 'x'))
    expect(valueKey('q', 'x')).not.toBe(valueKey('q', 'x '))
  })
  it('a recheck names a value by its label or its value', () => {
    expect(asked(['пусто'], 'пусто', '')).toBe(true)
    expect(asked(['<b>'], 'html', '<b>')).toBe(true)
    expect(asked(['другое'], 'html', '<b>')).toBe(false)
    expect(asked(undefined, 'html', '<b>')).toBe(false)
  })
})
