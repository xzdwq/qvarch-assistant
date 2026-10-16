import type { UiPrefs } from './types'

/**
 * The look of every window, from the user's theme settings: the contrast (surfaces, lines, text), the accent
 * colour, the panels' corners and the face of the numbers. The result is a set of CSS variables (see base.css).
 */
export type Contrast = UiPrefs['theme']['contrast']

const SURFACES: Record<Contrast, Record<string, string>> = {
  soft: {
    bg: '#0d1117', panel: '#161b22', 'panel-2': '#1a212b', 'panel-3': '#222b36', 'field-bg': '#0f141b', hover: '#1f2731', pop: '#1a212b',
    border: '#212a36', 'border-2': '#2d3745', 'border-3': '#3a4658',
    'text-hi': '#f0f3f6', text: '#d7dde7', 'text-2': '#adb7c6', muted: '#7f8b9d', dim: '#566173',
  },
  normal: {
    bg: '#0a0d12', panel: '#141920', 'panel-2': '#1a212b', 'panel-3': '#232c38', 'field-bg': '#0c1016', hover: '#212a35', pop: '#1a212b',
    border: '#2a3442', 'border-2': '#374355', 'border-3': '#47566b',
    'text-hi': '#f7f9fb', text: '#e3e8ef', 'text-2': '#bcc5d2', muted: '#8f9bad', dim: '#647185',
  },
  high: {
    bg: '#06080b', panel: '#11151b', 'panel-2': '#181e27', 'panel-3': '#222a35', 'field-bg': '#090c10', hover: '#222b37', pop: '#181e27',
    border: '#333e4e', 'border-2': '#465368', 'border-3': '#5a6980',
    'text-hi': '#ffffff', text: '#eef2f7', 'text-2': '#cfd6e0', muted: '#a0abbc', dim: '#77849a',
  },
}

export const ACCENTS = [
  { id: '#ff6b00', label: 'Оранжевый' },
  { id: '#18ffff', label: 'Бирюзовый' },
  { id: '#00e676', label: 'Зелёный' },
  { id: '#448aff', label: 'Синий' },
  { id: '#8b7cff', label: 'Фиолетовый' },
  { id: '#ffb300', label: 'Янтарный' },
  { id: '#ff4f9a', label: 'Розовый' },
]

export const DEFAULT_THEME: UiPrefs['theme'] = { contrast: 'high', accent: '#ff6b00', radius: 6, mono: true }

const HEX = /^#[0-9a-f]{6}$/i
export function cleanTheme(t: Partial<UiPrefs['theme']> | undefined): UiPrefs['theme'] {
  const r = Number(t?.radius)
  return {
    contrast: t?.contrast === 'soft' || t?.contrast === 'normal' || t?.contrast === 'high' ? t.contrast : DEFAULT_THEME.contrast,
    accent: typeof t?.accent === 'string' && HEX.test(t.accent) ? t.accent.toLowerCase() : DEFAULT_THEME.accent,
    radius: Number.isFinite(r) ? Math.min(14, Math.max(0, Math.round(r))) : DEFAULT_THEME.radius,
    mono: t?.mono ?? DEFAULT_THEME.mono,
  }
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const toHex = (c: number[]) => `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`
const mix = (a: number[], b: number[], k: number) => a.map((x, i) => x + (b[i] - x) * k)
/** Relative luminance 0..1 (sRGB). */
function lum([r, g, b]: number[]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** The canvas colour (the native window controls follow it). */
export const themeBg = (t: UiPrefs['theme']) => SURFACES[cleanTheme(t).contrast].bg
export const themeSymbol = (t: UiPrefs['theme']) => SURFACES[cleanTheme(t).contrast]['text-2']

/** Every CSS variable of the theme. */
export function themeVars(theme: Partial<UiPrefs['theme']> | undefined): Record<string, string> {
  const t = cleanTheme(theme)
  const a = rgb(t.accent)
  const white = [255, 255, 255]
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(SURFACES[t.contrast])) out[`--${k}`] = v
  out['--accent'] = t.accent
  out['--accent-rgb'] = a.join(' ')
  out['--accent-hi'] = toHex(mix(a, white, 0.2))
  out['--accent-fg'] = toHex(mix(a, white, t.contrast === 'soft' ? 0.35 : 0.45))
  out['--accent-soft'] = `rgb(${a.join(' ')} / ${t.contrast === 'high' ? 0.2 : 0.14})`
  out['--accent-line'] = `rgb(${a.join(' ')} / 0.55)`
  out['--on-accent'] = lum(a) > 0.35 ? '#0a0d12' : '#ffffff'
  out['--r3'] = `${t.radius}px`
  out['--r2'] = `${Math.round(t.radius / 2)}px`
  out['--r1'] = `${Math.round(t.radius / 3)}px`
  out['--font-data'] = t.mono ? "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, monospace" : 'var(--font-ui)'
  return out
}
