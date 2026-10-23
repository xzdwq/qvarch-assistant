import { describe, expect, it } from 'vitest'
import { QA_ROUTES } from '../../src/shared/ipc/routes'

/** The window ↔ main contract: one channel per method, named by convention. */
describe('IPC routes', () => {
  const routes = Object.entries(QA_ROUTES)
  it('every channel is used by one method only', () => {
    const channels = routes.map(([, r]) => r.channel)
    expect(new Set(channels).size).toBe(channels.length)
    for (const c of channels) expect(c).toMatch(/^qa:\w+$/)
  })
  it('events are the on… methods, and only they', () => {
    for (const [name, r] of routes) expect(r.kind === 'event', name).toBe(/^on[A-Z]/.test(name))
  })
  it('keeps the channels the app has always used', () => {
    expect(QA_ROUTES.getDay).toEqual({ kind: 'invoke', channel: 'qa:getDay' })
    expect(QA_ROUTES.setSelection).toEqual({ kind: 'send', channel: 'qa:setSelection' })
    expect(QA_ROUTES.onDayState).toEqual({ kind: 'event', channel: 'qa:dayState' })
    expect(QA_ROUTES.onLoopPass).toEqual({ kind: 'event', channel: 'qa:loopPass' })
  })
})
