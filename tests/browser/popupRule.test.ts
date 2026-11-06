import { describe, expect, it } from 'vitest'
import { newWindowPlace } from '../../src/shared/browser/popupRule'

describe('where a page\'s new window goes', () => {
  it('a popup with features — a window of its own (a sign-in popup starts blank)', () => {
    expect(newWindowPlace('new-window', 'about:blank')).toBe('window')
    expect(newWindowPlace('new-window', 'https://id.example.com/authorize?x=1')).toBe('window')
    expect(newWindowPlace('new-window', 'HTTP://example.com')).toBe('window')
  })
  it('a link\'s new tab — a tab', () => {
    expect(newWindowPlace('foreground-tab', 'https://example.com')).toBe('tab')
    expect(newWindowPlace('background-tab', 'http://example.com')).toBe('tab')
    expect(newWindowPlace('other', 'file:///C:/a.txt')).toBe('tab')
  })
  it('a popup to what a window must not show — a tab, or nowhere', () => {
    expect(newWindowPlace('new-window', 'file:///C:/a.txt')).toBe('tab')
    expect(newWindowPlace('new-window', 'javascript:alert(1)')).toBe('none')
    expect(newWindowPlace('new-window', 'about:blank#x')).toBe('none')
  })
  it('a blank tab has nothing to show', () => {
    expect(newWindowPlace('foreground-tab', 'about:blank')).toBe('none')
    expect(newWindowPlace('foreground-tab', 'chrome://settings')).toBe('none')
  })
})
