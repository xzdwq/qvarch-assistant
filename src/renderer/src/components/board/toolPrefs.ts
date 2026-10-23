import type { ShapeKind } from '@shared/whiteboard'
import { cssHex } from '../../lib/cssColor'
import { cssPalette } from '../../lib/cssPalette'

/** The board's tools and their remembered settings (shared by every board, kept in localStorage). */

export type Tool = 'select' | 'pen' | 'nib' | 'marker' | 'eraser' | 'text' | 'shape' | 'hand'

export interface ToolPrefs {
  tool: Tool
  penColor: string
  penSize: number
  markerColor: string
  markerSize: number
  /** Screen px. */
  eraserSize: number
  /** The eraser takes whole lines (else — only what it touches). */
  eraseWhole: boolean
  textSize: number
  minimap: boolean
  /** 0.05…1 */
  penOpacity: number
  markerOpacity: number
  /** The pen's line goes from its colour (light pressure) to this one (firm). */
  gradient: boolean
  gradColor: string
  /** The eraser grows with the pen's pressure. */
  eraserPressure: boolean
  shapeKind: ShapeKind
  shapeWidth: number
  shapeFill: boolean
  shapeDash: boolean
  /** The ink pen's nib: its width and its angle (degrees; a tablet's tilt turns it). */
  nibSize: number
  nibAngle: number
  /** A stroke held still at its end becomes the shape it means (a circle, a rectangle, a line…). */
  snapShapes: boolean
}

/** The defaults; the colours — from the theme's CSS (read when the settings are first made). */
const defaultToolPrefs = (): ToolPrefs => ({
  tool: 'pen',
  penColor: cssHex('--board-pen-default') ?? '',
  penSize: 3,
  markerColor: cssHex('--board-marker-default') ?? '',
  markerSize: 14,
  eraserSize: 12,
  eraseWhole: false,
  textSize: 18,
  minimap: true,
  penOpacity: 1,
  markerOpacity: 0.4,
  gradient: false,
  gradColor: cssHex('--board-gradient-default') ?? '',
  eraserPressure: false,
  shapeKind: 'rect',
  shapeWidth: 2,
  shapeFill: false,
  shapeDash: false,
  nibSize: 6,
  nibAngle: 40,
  snapShapes: true,
})

const PREFS_KEY = 'qa.board.tools'

/** The saved settings over the defaults (nothing saved / broken — the defaults). */
export function readToolPrefs(): ToolPrefs {
  try {
    return { ...defaultToolPrefs(), ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ToolPrefs>) }
  } catch {
    return defaultToolPrefs()
  }
}
export function saveToolPrefs(p: ToolPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // private mode — fine
  }
}

/** A tool with a size: its presets and limits (the wheel goes between the limits) and the setting it sizes. */
export interface SizeSpec {
  presets: number[]
  min: number
  max: number
  key: 'penSize' | 'nibSize' | 'markerSize' | 'eraserSize' | 'textSize' | 'shapeWidth'
}
export type SizedTool = Exclude<Tool, 'select' | 'hand'>
export const SIZES: Record<SizedTool, SizeSpec> = {
  pen: { presets: [3, 8], min: 0.5, max: 80, key: 'penSize' },
  nib: { presets: [4, 10], min: 1, max: 60, key: 'nibSize' },
  marker: { presets: [14, 28], min: 4, max: 160, key: 'markerSize' },
  eraser: { presets: [12, 40], min: 4, max: 240, key: 'eraserSize' },
  text: { presets: [18, 32], min: 8, max: 200, key: 'textSize' },
  shape: { presets: [2, 4], min: 0.5, max: 40, key: 'shapeWidth' },
}
/** A size kept between the tool's limits, to 0.1. */
export const clampSize = (spec: SizeSpec, s: number) => Math.round(Math.min(spec.max, Math.max(spec.min, s)) * 10) / 10

/** The pen colours (theme CSS): dark ink on light paper, light ink on dark paper. */
export const inkColors = (darkPaper: boolean) => cssPalette(darkPaper ? '--board-ink-on-dark' : '--board-ink-on-light')
/** The marker's colours (theme CSS). */
export const markerColors = () => cssPalette('--board-marker')
