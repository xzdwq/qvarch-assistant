/**
 * A pen tablet driven by Qvarch itself (XP-Pen Deco family — the vendor HID interface): the pen moves the mouse
 * on the chosen monitor, on all of them or only inside the Qvarch window; the tip clicks past a pressure
 * threshold; the side buttons are mapped. Pressure and tilt reach Qvarch's own drawing surfaces directly.
 *
 * Windows here does not take a synthetic pen (InjectSyntheticPointerInput is silently ignored) and mapping the
 * system pen to a monitor needs admin rights — hence the mouse output. Other apps get no pressure.
 *
 * The same mapping maths runs in the helper (resources/tablet.ps1, C#) per report; here it is for the
 * settings preview and the tests.
 */

/** The tablet turned clockwise, degrees. */
export const TABLET_ROTATIONS = [0, 90, 180, 270] as const
export type TabletRotation = (typeof TABLET_ROTATIONS)[number]
/** What a pen side button presses. */
export const TABLET_BUTTONS = ['right', 'middle', 'none'] as const
export type TabletButton = (typeof TABLET_BUTTONS)[number]
/** Where the pen drives the mouse: a monitor, all of them, the Qvarch window, the board on screen. */
export const TABLET_TARGET_KINDS = ['monitor', 'all', 'window', 'canvas'] as const
export type TabletTargetKind = (typeof TABLET_TARGET_KINDS)[number]
/** canvas — the board on screen (its visible area, whatever its pan / zoom); none shown → the Qvarch window. */
export type TabletTarget = { kind: 'monitor'; name?: string } | { kind: Exclude<TabletTargetKind, 'monitor'> }

const isOneOf = <T>(list: readonly T[], v: unknown): v is T => list.includes(v as T)
/** Turned a quarter: the tablet's long side stands upright. */
export const isQuarterTurn = (rot: TabletRotation): boolean => rot === 90 || rot === 270

export interface TabletPrefs {
  /** Qvarch reads the tablet (the system pen stops until the tablet is plugged in again). */
  enabled: boolean
  target: TabletTarget
  /** The monitor used when the target is the Qvarch window and it is hidden / minimized ('' — the primary). */
  fallback: string
  /** Crop the tablet area to the target's proportions (a circle stays a circle). */
  keepAspect: boolean
  /** The tablet turned clockwise (left-handed use: 180). */
  rotation: TabletRotation
  /** Tip pressure (0…1 of the maximum) that presses the left button. */
  click: number
  /** Drawing pressure: below `pmin` — nothing, at `pmax` — full; `curve` −1 (soft) … 1 (firm). */
  pmin: number
  pmax: number
  curve: number
  /** Tilt reaches Qvarch's drawing surfaces. */
  tilt: boolean
  /** Ink in Qvarch's drawing (any pointer): how lazily the line follows, how round, how much the pressure thins it. */
  streamline: number
  smoothing: number
  thinning: number
  button1: TabletButton
  button2: TabletButton
  /** The tablet's 8 express keys (K1…K8): a key combination each ("Ctrl+Z", "Space", "" — nothing). */
  keys: string[]
  /** Several boards on screen: how long the pen is held at an edge before it goes over to the next one, ms. */
  hopMs: number
}
/** The pen held at an edge before it goes over: the bounds of the setting, ms. */
export const HOP_MS_RANGE = { min: 150, max: 2000 } as const

export const DEFAULT_TABLET: TabletPrefs = {
  enabled: false,
  target: { kind: 'monitor' },
  fallback: '',
  keepAspect: true,
  rotation: 0,
  click: 0.04,
  pmin: 0.02,
  pmax: 0.85,
  curve: 0,
  tilt: true,
  streamline: 0.55,
  smoothing: 0.6,
  thinning: 0.55,
  button1: 'right',
  button2: 'middle',
  // as printed on the Deco mini7 V2: brush, eraser, Alt, Space, undo, zoom in / out, (the driver panel — none)
  keys: ['B', 'E', 'Alt', 'Space', 'Ctrl+Z', 'Ctrl+=', 'Ctrl+-', ''],
  hopMs: 450,
}

/** A monitor as the helper sees it — physical pixels, Windows device name. */
export interface TabletMonitor {
  name: string
  x: number
  y: number
  w: number
  h: number
  primary: boolean
}

export type TabletStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | { state: 'searching' }
  | { state: 'connected'; device: string }
  | { state: 'error'; message: string }

/** A pen sample: position in the tablet (0…1, after rotation), raw pressure 0…1, tilt in degrees. */
export interface TabletSample {
  x: number
  y: number
  p: number
  tx: number
  ty: number
  /** In range (hovering or touching) / touching. */
  in: boolean
  c: boolean
  /** Side buttons (bit 0 — the first, bit 1 — the second). */
  b: number
  /** When it arrived (renderer clock). */
  at?: number
}

export interface TabletState {
  prefs: TabletPrefs
  status: TabletStatus
  monitors: TabletMonitor[]
  /** The active board's visible area (physical px, from the window's client corner), if one is shown. */
  canvas?: { x: number; y: number; w: number; h: number }
}

/** What the main side tells the window about the tablet. */
export type TabletMsg = { type: 'state'; state: TabletState } | { type: 'sample'; s: TabletSample } | { type: 'keys'; mask: number } | { type: 'aux'; raw: string }

/** The Deco mini7's working area, mm — the tablet's own proportions. */
export const TABLET_MM = { w: 177.8, h: 111.095 }

/** A stored target made valid: a known kind (a monitor keeps its name), anything else — the primary monitor. */
function cleanTarget(t: Partial<TabletTarget> | undefined): TabletTarget {
  const stored = t?.kind
  const kind = isOneOf(TABLET_TARGET_KINDS, stored) ? stored : 'monitor'
  if (kind !== 'monitor') return { kind }
  const name = t && 'name' in t ? t.name : undefined
  return { kind, name: typeof name === 'string' ? name : undefined }
}

export function clampPrefs(p: Partial<TabletPrefs>): TabletPrefs {
  const d = DEFAULT_TABLET
  const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def)
  const btn = (v: unknown, def: TabletButton): TabletButton => (isOneOf(TABLET_BUTTONS, v) ? v : def)
  const pmin = num(p.pmin, 0, 0.5, d.pmin)
  return {
    enabled: !!p.enabled,
    target: cleanTarget(p.target),
    fallback: typeof p.fallback === 'string' ? p.fallback : '',
    keepAspect: p.keepAspect ?? d.keepAspect,
    rotation: isOneOf(TABLET_ROTATIONS, p.rotation) ? p.rotation : 0,
    click: num(p.click, 0.005, 0.6, d.click),
    pmin,
    pmax: Math.max(pmin + 0.05, num(p.pmax, 0.1, 1, d.pmax)),
    curve: num(p.curve, -1, 1, d.curve),
    tilt: p.tilt ?? d.tilt,
    streamline: num(p.streamline, 0, 0.95, d.streamline),
    smoothing: num(p.smoothing, 0, 1, d.smoothing),
    thinning: num(p.thinning, 0, 0.9, d.thinning),
    button1: btn(p.button1, d.button1),
    button2: btn(p.button2, d.button2),
    keys: Array.from({ length: 8 }, (_, i) => (Array.isArray(p.keys) && typeof p.keys[i] === 'string' && (p.keys[i] === '' || comboToVk(p.keys[i]) !== undefined) ? p.keys[i] : d.keys[i])),
    hopMs: Math.round(num(p.hopMs, HOP_MS_RANGE.min, HOP_MS_RANGE.max, d.hopMs)),
  }
}

/** Drawing pressure 0…1 from the raw one: the dead zone, the saturation and the curve (firm = needs more force). */
export function pressureCurve(raw: number, p: Pick<TabletPrefs, 'pmin' | 'pmax' | 'curve'>): number {
  if (raw <= p.pmin) return 0
  const t = Math.min(1, (raw - p.pmin) / Math.max(0.01, p.pmax - p.pmin))
  return Math.pow(t, Math.pow(2, p.curve * 1.5))
}

/** The raw (unrotated) tablet point 0…1 seen through the rotation. */
export function rotate(u: number, v: number, rot: TabletRotation): [number, number] {
  return ROTATE[rot](u, v)
}
const ROTATE: Record<TabletRotation, (u: number, v: number) => [number, number]> = {
  0: (u, v) => [u, v],
  90: (u, v) => [1 - v, u],
  180: (u, v) => [1 - u, 1 - v],
  270: (u, v) => [v, 1 - u],
}

/** The used part of the (rotated) tablet: all of it, or cropped to the target's proportions, centred. [x0, y0, x1, y1] */
export function activeArea(rot: TabletRotation, keepAspect: boolean, targetW: number, targetH: number): [number, number, number, number] {
  if (!keepAspect || targetW <= 0 || targetH <= 0) return [0, 0, 1, 1]
  const tab = isQuarterTurn(rot) ? TABLET_MM.h / TABLET_MM.w : TABLET_MM.w / TABLET_MM.h
  const scr = targetW / targetH
  if (tab > scr) {
    const f = scr / tab
    return [(1 - f) / 2, 0, (1 + f) / 2, 1]
  }
  const f = tab / scr
  return [0, (1 - f) / 2, 1, (1 + f) / 2]
}

/** A raw tablet point → a screen point in the target rectangle (physical pixels). */
export function mapToScreen(u: number, v: number, prefs: Pick<TabletPrefs, 'rotation' | 'keepAspect'>, target: { x: number; y: number; w: number; h: number }): [number, number] {
  const [ru, rv] = rotate(u, v, prefs.rotation)
  const [x0, y0, x1, y1] = activeArea(prefs.rotation, prefs.keepAspect, target.w, target.h)
  const cu = Math.min(1, Math.max(0, (ru - x0) / (x1 - x0)))
  const cv = Math.min(1, Math.max(0, (rv - y0) / (y1 - y0)))
  return [target.x + cu * (target.w - 1), target.y + cv * (target.h - 1)]
}

/** The union of the monitors (the "all monitors" target). */
export function monitorsBounds(list: TabletMonitor[]): { x: number; y: number; w: number; h: number } {
  if (!list.length) return { x: 0, y: 0, w: 1, h: 1 }
  const x = Math.min(...list.map((m) => m.x))
  const y = Math.min(...list.map((m) => m.y))
  const r = Math.max(...list.map((m) => m.x + m.w))
  const b = Math.max(...list.map((m) => m.y + m.h))
  return { x, y, w: r - x, h: b - y }
}

// ---------- express keys: combinations ----------
const NAMED: Record<string, number> = {
  Ctrl: 0x11, Shift: 0x10, Alt: 0x12, Win: 0x5b,
  Space: 0x20, Enter: 0x0d, Tab: 0x09, Esc: 0x1b, Backspace: 0x08, Delete: 0x2e, Insert: 0x2d,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28,
  '=': 0xbb, '+': 0xbb, '-': 0xbd, ',': 0xbc, '.': 0xbe, '/': 0xbf, ';': 0xba, "'": 0xde, '`': 0xc0, '[': 0xdb, ']': 0xdd, '\\': 0xdc,
}
type KeyComboEvent = { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }
/** The modifiers: the key event's flag and the name, in the order a combination names them. */
const MOD_FLAGS: Array<[keyof Omit<KeyComboEvent, 'code'>, string]> = [
  ['ctrlKey', 'Ctrl'],
  ['shiftKey', 'Shift'],
  ['altKey', 'Alt'],
  ['metaKey', 'Win'],
]
const MODS = MOD_FLAGS.map(([, name]) => name)
/** Only modifiers ("Alt", "Ctrl+Shift") — no key that ends the combination yet. */
export const isModifiersOnly = (combo: string): boolean => !!combo && combo.split('+').every((p) => MODS.includes(p))

/** "Ctrl+Shift+Z" → Windows virtual-key codes in press order (modifiers first); undefined — not a combination. */
export function comboToVk(combo: string): number[] | undefined {
  const parts = combo.split('+').map((s) => s.trim())
  // "Ctrl++" — the plus key itself
  if (combo.endsWith('++')) parts.splice(parts.length - 2, 2, '+')
  const out: number[] = []
  let main = 0
  for (const p of parts) {
    if (!p) return undefined
    const up = p.length === 1 ? p.toUpperCase() : p
    let vk = NAMED[p] ?? NAMED[up]
    if (vk === undefined && /^[A-Z0-9]$/.test(up)) vk = up.charCodeAt(0)
    if (vk === undefined && /^F([1-9]|1[0-9]|2[0-4])$/.test(up)) vk = 0x6f + Number(up.slice(1))
    if (vk === undefined) return undefined
    if (MODS.includes(p)) {
      if (!out.includes(vk)) out.push(vk)
    } else {
      if (main) return undefined
      main = vk
    }
  }
  if (main) out.push(main)
  return out.length ? out : undefined
}

/** A pressed key (a keydown) → its combination name ("" — only modifiers so far). Layout-independent (by code). */
export function comboOf(e: KeyComboEvent): string {
  const mods = MOD_FLAGS.filter(([flag]) => e[flag]).map(([, name]) => name)
  const k = keyName(e.code)
  // a modifier alone ("Alt", "Ctrl") is a combination too, once released — the caller decides
  if (!k) return mods.join('+')
  return [...mods, k].join('+')
}
/** Key codes named by a pattern: letters, digits, F-keys. */
const CODE_PATTERNS: Array<[RegExp, (code: string) => string]> = [
  [/^Key[A-Z]$/, (c) => c.slice(3)],
  [/^Digit[0-9]$/, (c) => c.slice(5)],
  [/^F([1-9]|1[0-9]|2[0-4])$/, (c) => c],
]
/** The other keys a combination may end with (a key code → its name). */
const CODE_NAMES: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down',
  Equal: '=', NumpadAdd: '=', Minus: '-', NumpadSubtract: '-', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\',
}
/** A key code → its name in a combination ("" — a modifier or a key that cannot be one). */
function keyName(code: string): string {
  const byPattern = CODE_PATTERNS.find(([re]) => re.test(code))
  return byPattern ? byPattern[1](code) : (CODE_NAMES[code] ?? '')
}
