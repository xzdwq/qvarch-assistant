import { describe, expect, it } from 'vitest'
import { nameTakenIn, renameBrowserIn } from '../../src/notebook/blocks/browser/model'
import { BLOCK_SPECS } from '../../src/notebook/blocks/specs'

const NOTE = ['# Тест', '', '```browser name=site', 'url: https://x.test', '```', '', '```ts playwright name=smoke browser=qvarch in=site', "await page.goto('/')", '```', '', '```ts playwright name=other browser=qvarch in=site2', '```'].join('\n')

describe('a note’s browser renamed', () => {
  it('its own name and the Playwright blocks that run in it follow; a like name is left alone', () => {
    const out = renameBrowserIn(NOTE, 3, 'site', 'browser')!.split('\n')
    expect(out[2]).toBe('```browser name=browser')
    expect(out[6]).toBe('```ts playwright name=smoke browser=qvarch in=browser')
    expect(out[10]).toBe('```ts playwright name=other browser=qvarch in=site2')
  })
  it('an unnamed one gets a name; a line that is not a browser block — none', () => {
    expect(renameBrowserIn('```browser\nurl: about:blank\n```', 1, undefined, 'browser')?.split('\n')[0]).toBe('```browser name=browser')
    expect(renameBrowserIn(NOTE, 7, 'site', 'x')).toBeUndefined()
  })
  it('a name another block holds is taken; its own is not', () => {
    expect(nameTakenIn(NOTE, 'smoke', 3)).toBe(true)
    expect(nameTakenIn(NOTE, 'site', 3)).toBe(false)
    expect(nameTakenIn(NOTE, 'free', 3)).toBe(false)
  })
})

describe('how components fold', () => {
  it('every component folds to its own head — but the chat (its own fold), a toggle, a loop’s end, a player, a picture', () => {
    expect(Object.values(BLOCK_SPECS).filter((s) => s.fold === 'none').map((s) => s.kind).sort()).toEqual(['audio', 'chat', 'image', 'loopEnd', 'toggle'])
    expect(BLOCK_SPECS.browser.fold).toBeUndefined()
  })
})
