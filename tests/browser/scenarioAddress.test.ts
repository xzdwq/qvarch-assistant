import { describe, expect, it } from 'vitest'
import { sameAddress, startAddressOf } from '../../src/shared/browser/scenarioAddress'

describe('a scenario’s address', () => {
  it('starts at its first written page.goto', () => {
    expect(startAddressOf("await qa.window({ width: 1 })\nawait page.goto('https://example.com/a?b=1')\nawait page.goto('https://other.test')")).toBe('https://example.com/a?b=1')
    expect(startAddressOf('await page.goto(`https://site.test/${id}`)')).toBeUndefined()
    expect(startAddressOf('await page.goto(url)')).toBeUndefined()
    expect(startAddressOf("await page.goto('about:blank')")).toBeUndefined()
  })
  it('knows the same page by its address — not by the fragment, a trailing slash or the case', () => {
    expect(sameAddress('https://Example.com/#top', 'https://example.com')).toBe(true)
    expect(sameAddress('https://example.com/a', 'https://example.com/b')).toBe(false)
    expect(sameAddress('https://example.com/?q=1', 'https://example.com/?q=2')).toBe(false)
  })
})
