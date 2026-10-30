import { closeSync, existsSync, mkdirSync, openSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sweepPwLeftovers, PW_LEFTOVER_AGE } from '../../src/main/runner/pwLeftovers'
import { testDir } from '../testTemp'

describe('Playwright\'s temp folders left behind', () => {
  it('its own old ones taken away; a fresh one, another program\'s, a file — left', async () => {
    const dir = testDir('pwtemp-')
    const now = Date.now()
    const make = (name: string, ageMs: number, file = false) => {
      const p = join(dir, name)
      if (file) writeFileSync(p, 'x')
      else {
        mkdirSync(join(p, 'Default', 'Cache'), { recursive: true })
        writeFileSync(join(p, 'Default', 'Cache', 'data_0'), 'x'.repeat(1000))
      }
      const t = new Date(now - ageMs)
      utimesSync(p, t, t)
      return p
    }
    const old = make('playwright_chromiumdev_profile-AbC123', PW_LEFTOVER_AGE * 3)
    const artifacts = make('playwright-artifacts-XyZ', PW_LEFTOVER_AGE * 2)
    const fresh = make('playwright_chromiumdev_profile-Fresh1', 60_000)
    const other = make('chrome_profile-123', PW_LEFTOVER_AGE * 5)
    const file = make('playwright_chromiumdev_profile-file', PW_LEFTOVER_AGE * 5, true)
    expect(await sweepPwLeftovers(dir, PW_LEFTOVER_AGE, now)).toBe(2)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(artifacts)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(other)).toBe(true)
    expect(existsSync(file)).toBe(true)
  })
  it.runIf(process.platform === 'win32')('an old one still in use (a browser holds a file in it) — left whole', async () => {
    const dir = testDir('pwtemp-')
    const p = join(dir, 'playwright_chromiumdev_profile-InUse')
    mkdirSync(p)
    writeFileSync(join(p, 'lockfile'), 'x')
    writeFileSync(join(p, 'Preferences'), '{}')
    const t = new Date(Date.now() - PW_LEFTOVER_AGE * 3)
    utimesSync(p, t, t)
    const fd = openSync(join(p, 'lockfile'), 'r+')
    try {
      expect(await sweepPwLeftovers(dir)).toBe(0)
      expect(existsSync(join(p, 'Preferences'))).toBe(true)
    } finally {
      closeSync(fd)
    }
    expect(await sweepPwLeftovers(dir)).toBe(1)
  })
  it('no temp folder — nothing, no error', async () => {
    expect(await sweepPwLeftovers(join(testDir('pwtemp-'), 'missing'))).toBe(0)
  })
})
