import type { TabletPrefs } from '@shared/tablet'
import type { BoardCtx } from './boardContext'
import { startErase, startShape, startTextTool } from './gestures/drawGestures'
import type { Gesture, PointerAt } from './gestures/gesture'
import { InkGesture } from './gestures/inkGesture'
import { hoverSelect, startSelect } from './gestures/selectGestures'
import type { BoardScene, StrokeStyle } from './scene'
import { inkColors, markerColors, SIZES, type SizeSpec, type Tool, type ToolPrefs } from './toolPrefs'

/** The sections of a tool's options popover (shown in this order). */
export type OptionSection = 'nibAngle' | 'opacity' | 'gradient' | 'eraser' | 'shape'

/** A tool's stroke: its style at the press (`nibAngle` — the nib's angle now: the pen's tilt or the set one). */
type StrokeOf = (tp: ToolPrefs, tablet: TabletPrefs | undefined, nibAngle: () => number) => StrokeStyle

/** One board tool: its key, cursor, colour, size, options and what a press with it starts. */
export interface ToolSpec {
  /** The key that picks it (KeyboardEvent.code). */
  key: string
  /** The sheet's cursor with it. */
  cursor: (scene: BoardScene) => string
  /** Its colour setting and palette (none — the tool takes no colour). */
  color?: { key: 'penColor' | 'markerColor'; palette: (darkPaper: boolean) => string[] }
  /** Its size (none — no size: the wheel moves the view). */
  size?: SizeSpec
  /** The wheel's hint while sizing it. */
  sizeLabel?: (size: number) => string
  /** The circle at the pointer: the tool's own size on screen (shown while working) or the line's width (hidden while drawing). */
  ring?: 'screen' | 'line'
  /** Its opacity setting (the options popover's slider). */
  opacityKey?: 'penOpacity' | 'markerOpacity'
  options: OptionSection[]
  /** Every button pans with it (the hand). */
  pans?: boolean
  /** The main button pressed on the sheet: what it starts. */
  start?: (b: BoardCtx, at: PointerAt, e: PointerEvent) => Gesture | undefined
  /** The pointer over the sheet, nothing pressed. */
  hover?: (b: BoardCtx, at: PointerAt) => void
  /** Its stroke (the ink tools). */
  stroke?: StrokeOf
}

const thickness = (s: number) => `Толщина ${s}`
const PEN_COLOR = { key: 'penColor', palette: inkColors } as const
const none = () => 'none'
/** The pressure-smoothing the tablet's settings give (or the defaults). */
const smoothing = (p: TabletPrefs | undefined) => ({ streamline: p?.streamline ?? 0.55, smoothing: p?.smoothing ?? 0.6 })
const startInk = (b: BoardCtx, at: PointerAt, e: PointerEvent) => new InkGesture(b, at, e, b.tools.strokeStyle())

export const TOOLS: Record<Tool, ToolSpec> = {
  select: { key: 'KeyV', cursor: (s) => s.selCursor.value, options: [], start: startSelect, hover: hoverSelect },
  pen: {
    key: 'KeyP',
    cursor: none,
    color: PEN_COLOR,
    size: SIZES.pen,
    sizeLabel: thickness,
    ring: 'line',
    opacityKey: 'penOpacity',
    options: ['opacity', 'gradient'],
    start: startInk,
    stroke: (tp, p) => ({ color: tp.penColor, size: tp.penSize, ...smoothing(p), thinning: p?.thinning ?? 0.55, opacity: tp.penOpacity, marker: false, gradient: tp.gradient ? tp.gradColor : undefined }),
  },
  nib: {
    key: 'KeyB',
    cursor: none,
    color: PEN_COLOR,
    size: SIZES.nib,
    sizeLabel: thickness,
    ring: 'line',
    opacityKey: 'penOpacity',
    options: ['nibAngle', 'opacity', 'gradient'],
    start: startInk,
    stroke: (tp, p, nibAngle) => ({ color: tp.penColor, size: tp.nibSize, ...smoothing(p), thinning: 0, opacity: tp.penOpacity, marker: false, nib: nibAngle(), gradient: tp.gradient ? tp.gradColor : undefined }),
  },
  marker: {
    key: 'KeyM',
    cursor: none,
    color: { key: 'markerColor', palette: markerColors },
    size: SIZES.marker,
    sizeLabel: thickness,
    ring: 'line',
    opacityKey: 'markerOpacity',
    options: ['opacity'],
    start: startInk,
    stroke: (tp, p) => ({ color: tp.markerColor, size: tp.markerSize, ...smoothing(p), thinning: 0, opacity: tp.markerOpacity, marker: true, gradient: undefined }),
  },
  eraser: { key: 'KeyE', cursor: none, size: SIZES.eraser, sizeLabel: (s) => `Ластик ${Math.round(s)}`, ring: 'screen', options: ['eraser'], start: startErase },
  text: { key: 'KeyT', cursor: () => 'text', color: PEN_COLOR, size: SIZES.text, sizeLabel: (s) => `Текст ${Math.round(s)}`, options: [], start: startTextTool },
  shape: { key: 'KeyS', cursor: () => 'crosshair', color: PEN_COLOR, size: SIZES.shape, sizeLabel: thickness, options: ['shape'], start: startShape },
  hand: { key: 'KeyH', cursor: () => 'grab', options: [], pans: true },
}

/** The tool a key picks (by KeyboardEvent.code). */
export const TOOL_BY_KEY: Record<string, Tool> = Object.fromEntries((Object.keys(TOOLS) as Tool[]).map((t) => [TOOLS[t].key, t]))
