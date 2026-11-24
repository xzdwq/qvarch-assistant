import { describe, expect, it } from 'vitest'
import { linkStatusMaxWidth, linkStatusPlace, linkStatusText } from '../../src/shared/browser/linkStatus'

describe('the link under the pointer', () => {
  it('is shown readable: escaped letters decoded, a broken escape left as it is', () => {
    expect(linkStatusText('https://a.test/%D0%BF%D1%83%D1%82%D1%8C?q=1')).toBe('https://a.test/путь?q=1')
    expect(linkStatusText('https://a.test/%E0%A4%A')).toBe('https://a.test/%E0%A4%A')
  })
  const page = { x: 100, y: 50, width: 800, height: 600 }
  it('sits in the page bottom-left corner, kept inside the page', () => {
    expect(linkStatusPlace(page, { width: 300, height: 22 })).toEqual({ x: 100, y: 628, width: 300, height: 22 })
    expect(linkStatusPlace(page, { width: 2000, height: 22 }).width).toBe(800)
  })
  it('moves to the bottom-right while the pointer is near the left place; far from it — stays', () => {
    expect(linkStatusPlace(page, { width: 300, height: 22 }, { x: 150, y: 640 }).x).toBe(600)
    expect(linkStatusPlace(page, { width: 300, height: 22 }, { x: 150, y: 300 }).x).toBe(100)
  })
  it('is at most a share of a wide page, never narrower than a narrow page lets it be', () => {
    expect(linkStatusMaxWidth(1000)).toBe(600)
    expect(linkStatusMaxWidth(100)).toBe(100)
  })
})
