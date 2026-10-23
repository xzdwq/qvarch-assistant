import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanTheme, CONTRASTS, DEFAULT_THEME, themeBg, themeRoot, themeSymbol, WINDOW_FRAME } from '../../src/shared/theme'

const THEME_CSS = readFileSync(resolve('src/renderer/src/styles/colors/theme.css'), 'utf8')

/** A variable of one contrast's block in theme.css (`:root[data-contrast='x']`). */
function cssVar(contrast: string, name: string): string | undefined {
  const block = new RegExp(`:root\\[data-contrast='${contrast}'\\]\\s*\\{([^}]*)\\}`).exec(THEME_CSS)?.[1] ?? ''
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1].trim()
}

describe('theme', () => {
  it("the window's frame colours equal the contrast's --bg / --text-2 in theme.css", () => {
    for (const c of CONTRASTS) {
      expect(cssVar(c, 'bg')).toBe(WINDOW_FRAME[c].bg)
      expect(cssVar(c, 'text-2')).toBe(WINDOW_FRAME[c].symbol)
    }
    expect(themeBg({ ...DEFAULT_THEME, contrast: 'normal' })).toBe('#0a0d12')
    expect(themeSymbol({ ...DEFAULT_THEME, contrast: 'high' })).toBe('#cfd6e0')
  })

  it('cleans unknown values to the defaults', () => {
    expect(cleanTheme(undefined)).toEqual(DEFAULT_THEME)
    expect(cleanTheme({ contrast: 'loud' as never, accent: 'red', radius: 99, mono: false })).toEqual({ ...DEFAULT_THEME, radius: 14, mono: false })
    expect(cleanTheme({ contrast: 'soft', accent: '#ABCDEF', radius: 3.6 })).toMatchObject({ contrast: 'soft', accent: '#abcdef', radius: 4 })
  })

  it('the root gets the contrast, the tone on the accent, the digits face and the user values', () => {
    expect(themeRoot({ contrast: 'soft', accent: '#ff6b00', radius: 6, mono: true })).toEqual({
      data: { contrast: 'soft', accentTone: 'dark', digits: 'mono' },
      vars: { '--accent': '#ff6b00', '--accent-rgb': '255 107 0', '--r3': '6px', '--r2': '3px', '--r1': '2px' },
    })
    expect(themeRoot({ accent: '#448aff', mono: false }).data).toEqual({ contrast: 'high', accentTone: 'dark', digits: 'ui' })
    expect(themeRoot({ accent: '#18ffff' }).data.accentTone).toBe('light')
  })
})
