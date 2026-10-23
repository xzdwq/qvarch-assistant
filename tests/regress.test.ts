import { describe, expect, it } from 'vitest'
import { parseRegress, regressMd, runSum, swapStand, unstable, type RegressRun } from '../src/shared/regress'
import { findBlocks } from '../src/shared/noteBlocks'

describe('«Регрессия»', () => {
  it('its settings round-trip, and it is a component of a note', () => {
    const md = regressMd({ folder: 'Журнал', deep: true, from: 'https://app.example.com', to: 'https://stage.example.com' })
    expect(parseRegress(md)).toEqual({ folder: 'Журнал', deep: true, from: 'https://app.example.com', to: 'https://stage.example.com' })
    expect(findBlocks(`текст\n\n${md}\n`.split('\n')).map((b) => b.kind)).toEqual(['regress'])
    expect(parseRegress('```regress\nне json\n```')).toEqual({ folder: '', deep: true })
  })
  it('the stand: the address swapped in the code (a trailing slash no matter); nothing to swap — as is', () => {
    const code = "await page.goto('https://app.example.com/kpa')\nawait page.goto('https://app.example.com/')"
    expect(swapStand(code, 'https://app.example.com/', 'https://stage.example.com')).toBe("await page.goto('https://stage.example.com/kpa')\nawait page.goto('https://stage.example.com/')")
    expect(swapStand(code, '', 'x')).toBe(code)
  })
  it('unstable: both passed and failed in its last runs; the sums', () => {
    const run = (s: 'ok' | 'fail', soft = false): RegressRun => ({ at: 1, ms: 1, items: [{ note: 'a.md', key: 'k', name: 't', state: s, soft }] })
    expect(unstable([run('ok'), run('ok')], 'a.md', 'k')).toBe(false)
    expect(unstable([run('ok'), run('fail'), run('ok')], 'a.md', 'k')).toBe(true)
    expect(runSum({ at: 1, ms: 1, items: [...run('ok').items, ...run('fail').items, ...run('fail', true).items] })).toEqual({ ok: 1, fail: 1, soft: 1, all: 3 })
  })
})
