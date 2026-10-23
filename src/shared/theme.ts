import type { UiPrefs } from './types'
import { CONTRASTS, type Contrast } from './contrast'

export { CONTRASTS, type Contrast }

/**
 * The look of every window, from the user's theme settings: the contrast (surfaces, lines, text), the accent
 * colour, the panels' corners and the face of the numbers. The colours live in CSS (styles/colors/theme.css),
 * picked by the root's data attributes; the user's own values (accent, corners) go in as CSS variables.
 */
export type Theme = UiPrefs['theme']

export const CONTRAST_LABELS: Record<Contrast, string> = { soft: 'Мягкий', normal: 'Обычный', high: 'Высокий' }

/**
 * The window's own colours in main (no CSS there): the canvas and the native min / max / close symbols.
 * They equal --bg and --text-2 of each contrast in theme.css (tests/integrations/theme.test.ts keeps them so).
 */
export const WINDOW_FRAME: Record<Contrast, { bg: string; symbol: string }> = {
  soft: { bg: '#0d1117', symbol: '#adb7c6' },
  normal: { bg: '#0a0d12', symbol: '#bcc5d2' },
  high: { bg: '#06080b', symbol: '#cfd6e0' },
}

export const DEFAULT_THEME: Theme = { contrast: 'high', accent: '#ff6b00', radius: 6, mono: true }

const HEX = /^#[0-9a-f]{6}$/i
const isContrast = (v: unknown): v is Contrast => (CONTRASTS as readonly unknown[]).includes(v)

/** The theme settings made valid: unknown values → the defaults, the corners within 0..14 px. */
export function cleanTheme(t: Partial<Theme> | undefined): Theme {
  const r = Number(t?.radius)
  return {
    contrast: isContrast(t?.contrast) ? t.contrast : DEFAULT_THEME.contrast,
    accent: typeof t?.accent === 'string' && HEX.test(t.accent) ? t.accent.toLowerCase() : DEFAULT_THEME.accent,
    radius: Number.isFinite(r) ? Math.min(14, Math.max(0, Math.round(r))) : DEFAULT_THEME.radius,
    mono: t?.mono ?? DEFAULT_THEME.mono,
  }
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
/** Relative luminance 0..1 (sRGB). */
function lum([r, g, b]: number[]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** The window's canvas colour (the native window controls follow it). */
export const themeBg = (t: Theme) => WINDOW_FRAME[cleanTheme(t).contrast].bg
export const themeSymbol = (t: Theme) => WINDOW_FRAME[cleanTheme(t).contrast].symbol

/** What a window's root element gets from the theme: its data attributes (theme.css picks by them) and CSS variables. */
export interface ThemeRoot {
  /** `data-contrast`, `data-accent-tone` (text on the accent: dark on a light one), `data-digits`. */
  data: { contrast: Contrast; accentTone: 'light' | 'dark'; digits: 'mono' | 'ui' }
  vars: Record<`--${string}`, string>
}

/** The theme as the root element takes it. */
export function themeRoot(theme: Partial<Theme> | undefined): ThemeRoot {
  const t = cleanTheme(theme)
  const a = rgb(t.accent)
  return {
    data: { contrast: t.contrast, accentTone: lum(a) > 0.35 ? 'light' : 'dark', digits: t.mono ? 'mono' : 'ui' },
    vars: {
      '--accent': t.accent,
      '--accent-rgb': a.join(' '),
      '--r3': `${t.radius}px`,
      '--r2': `${Math.round(t.radius / 2)}px`,
      '--r1': `${Math.round(t.radius / 3)}px`,
    },
  }
}
