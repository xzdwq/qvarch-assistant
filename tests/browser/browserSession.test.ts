import { describe, expect, it } from 'vitest'
import { cleanSession } from '../../src/shared/browser/session'

describe('the browser\'s open tabs kept between runs', () => {
  it('a session as sent stays as it is', () => {
    const s = { panes: [{ urls: ['https://a.example', ''], active: 1 }, { urls: ['http://b.example/x?y=1'], active: 0 }] }
    expect(cleanSession(s)).toEqual(s)
  })
  it('nothing valid — none', () => {
    expect(cleanSession(undefined)).toBeUndefined()
    expect(cleanSession(null)).toBeUndefined()
    expect(cleanSession({})).toBeUndefined()
    expect(cleanSession({ panes: 'x' })).toBeUndefined()
    expect(cleanSession({ panes: [{ urls: [] }, null, { urls: 'a' }] })).toBeUndefined()
  })
  it('empty panes dropped, at most two kept', () => {
    const s = cleanSession({ panes: [{ urls: [] }, { urls: ['https://a.example'] }, { urls: ['https://b.example'] }, { urls: ['https://c.example'] }] })
    expect(s?.panes.map((p) => p.urls[0])).toEqual(['https://a.example', 'https://b.example'])
  })
  it('the shown tab is one of the pane\'s', () => {
    expect(cleanSession({ panes: [{ urls: ['https://a.example', 'https://b.example'], active: 9 }] })?.panes[0].active).toBe(1)
    expect(cleanSession({ panes: [{ urls: ['https://a.example'], active: -3 }] })?.panes[0].active).toBe(0)
    expect(cleanSession({ panes: [{ urls: ['https://a.example'], active: 'x' }] })?.panes[0].active).toBe(0)
  })
  it('an address it may not open again — a blank tab', () => {
    const s = cleanSession({ panes: [{ urls: ['javascript:alert(1)', 'about:blank', 42, 'file:///C:/a.html', 'qa-source:https://a.example', `https://a.example/${'x'.repeat(9000)}`], active: 0 }] })
    expect(s?.panes[0].urls).toEqual(['', '', '', 'file:///C:/a.html', 'qa-source:https://a.example', ''])
  })
})
