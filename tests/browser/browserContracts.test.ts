import { describe, expect, it, vi } from 'vitest'
import { dispatchBrowserEvent, type BrowserEventTable } from '../../src/shared/browser/api'
import { PAGE_CHANNELS } from '../../src/shared/browser/pageChannels'
import { PAGE_PERMISSIONS, permissionAllowed } from '../../src/shared/browser/permissions'
import { checkFailed, pageClosed, PW_LAUNCH } from '../../src/main/runner/pwBrowsers'
import { PW_BROWSERS } from '../../src/notebook/domain/blockInfo'

describe('browser page channels', () => {
  it('one channel per message, none shared', () => {
    const channels = Object.values(PAGE_CHANNELS)
    expect(new Set(channels).size).toBe(channels.length)
    for (const c of channels) expect(c).toMatch(/^qa:[\w-]+$/)
  })
  it('keeps the names the pages have always used', () => {
    expect(PAGE_CHANNELS.recAct).toBe('qa:pwrec-act')
    expect(PAGE_CHANNELS.pwSubmit).toBe('qa:bpw-submit')
    expect(PAGE_CHANNELS.rulerSet).toBe('qa:ruler-set')
    expect(PAGE_CHANNELS.lookReply).toBe('qa:page-look-reply')
  })
})

describe('browser events', () => {
  it('a named event reaches its handler with its payload; one not in the table — nothing', () => {
    const opened = vi.fn()
    const table: BrowserEventTable<'opened' | 'deviceError'> = { opened, deviceError: vi.fn() }
    dispatchBrowserEvent(table, 'opened', { id: 'a', opener: 'b' })
    expect(opened).toHaveBeenCalledWith({ id: 'a', opener: 'b' })
    expect(() => dispatchBrowserEvent(table, 'tabs', [])).not.toThrow()
  })
  it('a name of Object.prototype is not a handler', () => {
    expect(() => dispatchBrowserEvent({} as BrowserEventTable<'tabs'>, ...(['toString', null] as unknown as ['tabs', []]))).not.toThrow()
  })
})

describe('page permissions', () => {
  it('copying and notifications for every site whatever the setting', () => {
    expect(permissionAllowed('clipboard-sanitized-write', false, false)).toBe(true)
    expect(permissionAllowed('notifications', false, false)).toBe(true)
  })
  it('the camera, the microphone and reading the clipboard — to every site as the setting says', () => {
    expect(permissionAllowed('media', false, true)).toBe(true)
    expect(permissionAllowed('clipboard-read', false, true)).toBe(true)
    expect(permissionAllowed('media', false, false)).toBe(false)
    expect(permissionAllowed('clipboard-read', false, false)).toBe(false)
  })
  it('the app’s own page gets them even when off; a permission not named — refused to all', () => {
    expect(permissionAllowed('media', true, false)).toBe(true)
    expect(permissionAllowed('clipboard-read', true, false)).toBe(true)
    expect(permissionAllowed('geolocation', true, true)).toBe(false)
    expect(permissionAllowed('toString', true, true)).toBe(false)
    expect(Object.keys(PAGE_PERMISSIONS)).toContain('media')
  })
})

describe('Playwright run browsers and failures', () => {
  it('every browser a block names has its launch entry', () => {
    for (const b of PW_BROWSERS) expect(PW_LAUNCH[b].label).toBeTruthy()
    expect(PW_LAUNCH.msedge.channel).toBe('msedge')
    expect(PW_LAUNCH.chromium.channel).toBeUndefined()
  })
  it('a closed page: by the error class, else by its message', () => {
    const closed = Object.assign(new Error('x'), { name: 'TargetClosedError' })
    expect(pageClosed(closed, 'x')).toBe(true)
    expect(pageClosed(new Error('y'), 'page.click: Target page, context or browser has been closed')).toBe(true)
    expect(pageClosed(new Error('z'), 'Timeout 30000ms exceeded')).toBe(false)
  })
  it('a failed check: an expect’s matcher result, a ready check, else by the message', () => {
    expect(checkFailed(Object.assign(new Error('m'), { matcherResult: { pass: false } }), 'm')).toBe(true)
    expect(checkFailed(new Error('p'), 'Проверка «Поля» не прошла: 2 из 5')).toBe(true)
    expect(checkFailed(new Error('e'), 'expect(locator).toHaveText(expected) failed')).toBe(true)
    expect(checkFailed(new Error('t'), 'locator.click: Timeout 30000ms exceeded')).toBe(false)
  })
})
