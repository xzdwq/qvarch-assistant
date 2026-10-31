import { describe, expect, it } from 'vitest'
import { CdpBridge, PAGE_SESSION, type BridgeTarget } from '../../src/shared/browser/cdpBridge'
import { CdpUndoLog } from '../../src/shared/browser/cdpUndo'

/** The bridge over a fake page: what Playwright is answered, what reaches the page, what is undone after. */
const TARGET: BridgeTarget = { targetId: 'T1', url: 'https://site.test/', title: 'Сайт', product: 'Chrome/140.0.0.0', userAgent: 'Mozilla/5.0 Chrome/140' }
function setup() {
  const sent: Array<{ method: string; params?: Record<string, unknown>; sessionId?: string }> = []
  const out: Array<Record<string, any>> = []
  const page = {
    send: async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
      sent.push({ method, params, sessionId })
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: `s${sent.length}` }
      if (method === 'Network.getAllCookies') return { cookies: [{ name: 'sid' }] }
      if (method === 'Page.fail') throw new Error('nope')
      return {}
    },
  }
  const bridge = new CdpBridge(page, TARGET, (m) => out.push(m))
  const ask = async (id: number, method: string, params?: Record<string, unknown>, sessionId?: string) => {
    await bridge.handle({ id, method, params, sessionId })
    return out.find((m) => m.id === id)!
  }
  return { bridge, sent, out, ask }
}

describe('CdpBridge', () => {
  it('is a browser with one page: the page attached before the answer, in a context', async () => {
    const { out, ask } = setup()
    expect((await ask(1, 'Browser.getVersion')).result.product).toBe('Chrome/140.0.0.0')
    const r = await ask(2, 'Target.setAutoAttach', { autoAttach: true, flatten: true })
    const att = out.findIndex((m) => m.method === 'Target.attachedToTarget')
    expect(att).toBeGreaterThanOrEqual(0)
    expect(att).toBeLessThan(out.indexOf(r))
    expect(out[att].params).toMatchObject({ sessionId: PAGE_SESSION, targetInfo: { targetId: 'T1', type: 'page', browserContextId: expect.any(String) } })
    // a second ask attaches nothing more
    await ask(3, 'Target.setAutoAttach', { autoAttach: true, flatten: true })
    expect(out.filter((m) => m.method === 'Target.attachedToTarget')).toHaveLength(1)
  })

  it('passes the page’s commands to it, an iframe’s with its session; answers with the session asked by', async () => {
    const { sent, ask } = setup()
    const r = await ask(1, 'Runtime.evaluate', { expression: '1' }, PAGE_SESSION)
    expect(r.sessionId).toBe(PAGE_SESSION)
    expect(sent.at(-1)).toEqual({ method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: undefined })
    await ask(2, 'Runtime.enable', {}, 'child-9')
    expect(sent.at(-1)).toMatchObject({ method: 'Runtime.enable', sessionId: 'child-9' })
    expect((await ask(3, 'Page.fail', {}, PAGE_SESSION)).error.message).toBe('nope')
  })

  it('refuses what a borrowed page cannot do — with the reason, the page untouched', async () => {
    const { sent, ask } = setup()
    for (const [i, m] of ['Target.createTarget', 'Target.createBrowserContext', 'Storage.clearCookies', 'Browser.grantPermissions', 'Some.unknown'].entries()) {
      const r = await ask(i + 1, m, {})
      expect(r.error.message).toBeTruthy()
    }
    expect((await ask(9, 'Target.closeTarget', {}, PAGE_SESSION)).error.message).toMatch(/page\.close/)
    expect(sent).toHaveLength(0)
  })

  it('reads the cookies through the page', async () => {
    const { ask } = setup()
    expect((await ask(1, 'Storage.getCookies', {})).result.cookies).toEqual([{ name: 'sid' }])
  })

  it('gives more sessions on the same page (newCDPSession) — they reach the page itself, and hear it', async () => {
    const { bridge, sent, out, ask } = setup()
    const sid = (await ask(1, 'Target.attachToTarget', { targetId: 'T1', flatten: true })).result.sessionId
    expect(sid).not.toBe(PAGE_SESSION)
    await ask(2, 'Emulation.setDeviceMetricsOverride', { width: 375 }, sid)
    expect(sent.at(-1)?.sessionId).toBeUndefined()
    bridge.event('Page.loadEventFired', {})
    expect(out.filter((m) => m.method === 'Page.loadEventFired').map((m) => m.sessionId).sort()).toEqual([PAGE_SESSION, sid].sort())
    expect((await ask(3, 'Target.attachToTarget', { targetId: 'other' })).error).toBeTruthy()
    await ask(4, 'Target.detachFromTarget', { sessionId: sid })
    bridge.event('Page.domContentEventFired', {})
    expect(out.filter((m) => m.method === 'Page.domContentEventFired').map((m) => m.sessionId)).toEqual([PAGE_SESSION])
  })

  it('undoes what the run set on the page, lets its iframes go; a page gone — Playwright told, nothing more', async () => {
    const { bridge, sent, out, ask } = setup()
    await ask(1, 'Emulation.setFocusEmulationEnabled', { enabled: true }, PAGE_SESSION)
    await ask(2, 'Page.addScriptToEvaluateOnNewDocument', { source: '' }, PAGE_SESSION)
    await ask(3, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, PAGE_SESSION)
    await ask(4, 'Emulation.setDeviceMetricsOverride', { width: 1 }, PAGE_SESSION)
    await ask(5, 'Emulation.setDeviceMetricsOverride', { width: 2 }, PAGE_SESSION)
    await ask(6, 'Runtime.enable', {}, 'child-1')
    bridge.event('Target.attachedToTarget', { sessionId: 'child-1' })
    const before = sent.length
    await bridge.restore()
    const undone = sent.slice(before).map((s) => s.method)
    expect(undone).toEqual(['Target.detachFromTarget', 'Emulation.clearDeviceMetricsOverride', 'Target.setAutoAttach', 'Page.removeScriptToEvaluateOnNewDocument', 'Emulation.setFocusEmulationEnabled'])
    expect(sent.at(-1)?.params).toEqual({ enabled: false })
    bridge.pageGone()
    expect(out.some((m) => m.method === 'Target.detachedFromTarget')).toBe(false)
    expect((await ask(7, 'Runtime.evaluate', {}, PAGE_SESSION)).error).toBeTruthy()
  })
})

describe('CdpUndoLog', () => {
  it('notes only what leaves something; a setting turned off leaves nothing', () => {
    const u = new CdpUndoLog()
    u.note('Runtime.enable', {}, {})
    u.note('Page.setInterceptFileChooserDialog', { enabled: false }, {})
    u.note('Page.addScriptToEvaluateOnNewDocument', { source: '' }, {})
    expect(u.drain()).toEqual([])
    u.note('Runtime.addBinding', { name: 'b' }, {})
    expect(u.drain()).toEqual([{ method: 'Runtime.removeBinding', params: { name: 'b' } }])
    expect(u.drain()).toEqual([])
  })
})
